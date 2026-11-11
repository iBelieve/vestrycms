/**
 * Checks the GitHub App JWT (signed with a PKCS#1 key as GitHub issues them)
 * verifies with Node's crypto, and that the installation token provider
 * caches tokens.
 */
import { createServer, type IncomingMessage } from "node:http";
import { generateKeyPairSync, verify } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  installationTokenProvider,
  signAppJwt,
  type TokenProvider,
} from "../src/core/sources/github-app.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

describe("signAppJwt", () => {
  it.each([
    ["PKCS#1 (RSA PRIVATE KEY)", pkcs1],
    ["PKCS#8 (PRIVATE KEY)", pkcs8],
    ["escaped newlines", pkcs1.replace(/\n/g, "\\n")],
    ["base64-encoded PEM", Buffer.from(pkcs1).toString("base64")],
  ])("signs a verifiable JWT from %s", async (_label, pem) => {
    const jwt = await signAppJwt("12345", pem);
    const [h, p, s] = jwt.split(".");
    expect(
      verify(
        "sha256",
        Buffer.from(`${h}.${p}`),
        publicKey,
        Buffer.from(s!, "base64url"),
      ),
    ).toBe(true);
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(payload.iss).toBe("12345");
    expect(payload.exp - payload.iat).toBe(600);
  });
});

describe("installationTokenProvider", () => {
  const requests: IncomingMessage[] = [];
  const server = createServer((req, res) => {
    requests.push(req);
    res.writeHead(201, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        token: `ghs_${requests.length}`,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }),
    );
  });
  let provider: TokenProvider;
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    provider = installationTokenProvider({
      appId: "12345",
      installationId: "777",
      privateKey: pkcs1,
      apiBase: `http://127.0.0.1:${port}`,
    });
  });
  afterAll(() => void server.close());

  it("mints a token at the installation endpoint with the app JWT", async () => {
    expect(await provider()).toBe("ghs_1");
    expect(requests[0]!.url).toBe("/app/installations/777/access_tokens");
    expect(requests[0]!.headers.authorization).toMatch(/^Bearer ey/);
  });

  it("serves the second call from cache", async () => {
    expect(await provider()).toBe("ghs_1");
    expect(requests).toHaveLength(1);
  });
});

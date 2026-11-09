/**
 * Checks the GitHub App JWT (signed with a PKCS#1 key as GitHub issues them)
 * verifies with Node's crypto, and that the installation token provider
 * caches tokens. Run with `pnpm test`.
 */
import { createServer } from "node:http";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  installationTokenProvider,
  signAppJwt,
} from "../src/core/sources/github-app.js";

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok   ${msg}`);
};

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

for (const [label, pem] of [
  ["PKCS#1 (RSA PRIVATE KEY)", pkcs1],
  ["PKCS#8 (PRIVATE KEY)", pkcs8],
  ["escaped newlines", pkcs1.replace(/\n/g, "\\n")],
  ["base64-encoded PEM", Buffer.from(pkcs1).toString("base64")],
] as const) {
  const jwt = await signAppJwt("12345", pem);
  const [h, p, s] = jwt.split(".");
  const ok = verify(
    "sha256",
    Buffer.from(`${h}.${p}`),
    publicKey,
    Buffer.from(s!, "base64url"),
  );
  assert(ok, `JWT signed with ${label} verifies`);
  const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
  assert(
    payload.iss === "12345" && payload.exp - payload.iat === 600,
    "JWT claims",
  );
}

let mints = 0;
const server = createServer((req, res) => {
  const auth = req.headers.authorization ?? "";
  assert(
    req.url === "/app/installations/777/access_tokens" &&
      auth.startsWith("Bearer ey"),
    "token request hits the installation endpoint with the JWT",
  );
  mints++;
  res.writeHead(201, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      token: `ghs_${mints}`,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  );
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
const provider = installationTokenProvider({
  appId: "12345",
  installationId: "777",
  privateKey: pkcs1,
  apiBase: `http://127.0.0.1:${port}`,
});
assert(
  (await provider()) === "ghs_1",
  "provider returns the installation token",
);
assert(
  (await provider()) === "ghs_1" && mints === 1,
  "second call is served from cache",
);
server.close();
console.log("\ngithub-app: all good");

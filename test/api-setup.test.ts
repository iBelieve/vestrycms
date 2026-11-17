/**
 * How the HTTP API finds its content source and sign-in settings, and what
 * it reports when the host is missing one.
 */
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VestryConfig } from "../src/config/types.js";
import { createApi, type ApiOptions } from "../src/core/api.js";
import { MailError, memoryMailer, resendMailer } from "../src/core/mail.js";
import type { ContentSource } from "../src/core/source.js";

const ORIGIN = "http://vestry.test";
const config: VestryConfig = {
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  collections: {},
};
const memoryDatabase = () =>
  memoryAdapter({
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
  });
const signIn = {
  database: memoryDatabase(),
  mailer: memoryMailer(),
  secret: "test-secret-test-secret-test-secret-1234",
  migrate: false,
};

function api(options: Partial<ApiOptions> = {}) {
  return createApi({
    config,
    index: { builtAt: "", files: {} },
    basePath: "/admin",
    env: () => undefined,
    ...options,
  });
}

async function get<T>(
  instance: ReturnType<typeof createApi>,
  route: string,
  bindings?: Record<string, unknown>,
): Promise<{ status: number; data: T }> {
  const response = await instance.handle(
    new Request(`${ORIGIN}/admin/api${route}`),
    { bindings },
  );
  return { status: response.status, data: (await response.json()) as T };
}

type Config = {
  mode: string;
  source: { label: string; branch?: string };
  setupError?: string;
};
type Err = { error: { code: string; message: string } };

describe("the content source", () => {
  it("comes from the host's hook, created once", async () => {
    const source: ContentSource = {
      info: () => ({ kind: "github", label: "custom", branch: "draft" }),
      head: async () => "h",
      list: async () => [],
      read: async () => null,
      commit: async () => ({ sha: "c" }),
    };
    const createSource = vi.fn(() => source);
    const instance = api({ auth: signIn, createSource });
    const { data } = await get<Config>(instance, "/config");
    expect(data).toMatchObject({
      mode: "github",
      source: { label: "custom", branch: "draft" },
    });
    expect(data.setupError).toBeUndefined();
    await get(instance, "/config");
    expect(createSource).toHaveBeenCalledTimes(1);
  });

  it("is the GitHub repository when the app's variables are set", async () => {
    const env: Record<string, string> = {
      VESTRY_GITHUB_APP_ID: "1",
      VESTRY_GITHUB_INSTALLATION_ID: "2",
      VESTRY_GITHUB_PRIVATE_KEY: "key",
    };
    const instance = api({ auth: signIn, env: (key) => env[key] });
    const { data } = await get<Config>(instance, "/config");
    expect(data.source).toEqual({
      label: "o/r@main",
      branch: "main",
      url: "https://github.com/o/r",
    });
    expect(data.setupError).toBeUndefined();
  });

  it("names the missing variables, and the repository from the config", async () => {
    const instance = api({
      auth: signIn,
      env: (key) => (key === "VESTRY_GITHUB_APP_ID" ? "1" : undefined),
    });
    const { data } = await get<Config>(instance, "/config");
    expect(data.setupError).toBe(
      "Missing environment variables: VESTRY_GITHUB_INSTALLATION_ID, VESTRY_GITHUB_PRIVATE_KEY",
    );
    expect(data.source).toEqual({
      label: "o/r",
      branch: "main",
      url: "https://github.com/o/r",
    });
  });
});

describe("sign-in setup", () => {
  const setupError = async (
    options: Partial<ApiOptions>,
    bindings?: Record<string, unknown>,
  ) => (await get<Config>(api(options), "/config", bindings)).data.setupError;

  it("needs the D1 binding", async () => {
    expect(await setupError({})).toBe(
      "No VESTRY_DB D1 binding. Add it to wrangler.jsonc so Vestry can store users and sessions.",
    );
    expect(
      await setupError(
        { databaseBinding: "USERS" },
        { USERS: { prepare() {} } },
      ),
    ).toMatch(/^No USERS D1 binding/);
  });

  const d1 = { prepare() {}, batch() {}, exec() {} };

  it("then a mail provider", async () => {
    expect(await setupError({}, { VESTRY_DB: d1 })).toBe(
      "config.mail is not set. Vestry needs an email provider to send sign-in codes.",
    );
  });

  it("then Resend's key", async () => {
    expect(
      await setupError(
        {
          config: {
            ...config,
            mail: { provider: "resend", from: "a@example.org" },
          },
        },
        { VESTRY_DB: d1 },
      ),
    ).toBe("Missing environment variable: VESTRY_RESEND_API_KEY");
  });

  it("then a secret, except in development", async () => {
    const options = {
      config: {
        ...config,
        mail: { provider: "console" as const, from: "a@example.org" },
      },
    };
    expect(await setupError(options, { VESTRY_DB: d1 })).toMatch(
      /^Missing environment variable: VESTRY_SECRET/,
    );
    // In development sign-in is complete; what is missing next is the GitHub App.
    const dev = {
      ...options,
      auth: { ...signIn, secret: undefined, dev: true },
    };
    expect(await setupError(dev)).toMatch(
      /^Missing environment variables: VESTRY_GITHUB_APP_ID/,
    );
  });

  it("checks the table prefix", async () => {
    expect(
      await setupError({
        config: { ...config, auth: { tablePrefix: "bad prefix" } },
        auth: signIn,
      }),
    ).toMatch(/prefix/i);
  });

  it("refuses sign-in and content until it is complete", async () => {
    const instance = api({});
    const auth = await instance.handle(
      new Request(`${ORIGIN}/admin/api/auth/sign-out`, { method: "POST" }),
    );
    expect(auth.status).toBe(500);
    const content = await get<Err>(instance, "/collections/posts");
    expect(content).toMatchObject({ status: 401 });
    expect(content.data.error.code).toBe("setup");
  });
});

describe("the Resend mailer", () => {
  afterEach(() => vi.unstubAllGlobals());
  const message = { to: "a@example.org", subject: "Hi", text: "Hello" };

  it("posts the message to Resend's API", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await resendMailer({
      apiKey: "k",
      from: "Site <site@example.org>",
      apiBase: "https://mail.test/",
    }).send({ ...message, html: "<p>Hello</p>" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mail.test/emails");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer k");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Site <site@example.org>",
      to: ["a@example.org"],
      subject: "Hi",
      text: "Hello",
      html: "<p>Hello</p>",
    });
  });

  it("reports Resend's reason for a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ message: "Invalid from" }), {
          status: 422,
        }),
    );
    const send = resendMailer({ apiKey: "k", from: "x" }).send(message);
    await expect(send).rejects.toThrow(
      new MailError("Resend rejected the email: Invalid from (422)"),
    );
  });

  it("reports the status when Resend gives no reason", async () => {
    vi.stubGlobal("fetch", async () => new Response("oops", { status: 500 }));
    await expect(
      resendMailer({ apiKey: "k", from: "x" }).send(message),
    ).rejects.toThrow("Resend rejected the email: 500");
  });
});

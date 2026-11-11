/**
 * Exercises sign-in and user management end to end through the HTTP API,
 * with Better Auth on its memory adapter and a capturing mailer. The tests
 * share one database and run in order, each building on the last.
 */
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { createApi } from "../src/core/api.js";
import { memoryMailer } from "../src/core/mail.js";
import { LocalSource } from "../src/core/sources/local.js";
import type { VestryConfig } from "../src/config/types.js";

const codeFrom = (text: string) =>
  /(\d{3}) (\d{3})/.exec(text)!.slice(1).join("");

const ORIGIN = "http://vestry.test";
const config: VestryConfig = {
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  auth: { admins: ["Owner@Example.org"] },
  collections: {},
};
const mailer = memoryMailer();
const api = createApi({
  config,
  index: { builtAt: "", files: {} },
  basePath: "/admin",
  env: () => undefined,
  localSource: new LocalSource(process.cwd()),
  auth: {
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      rateLimit: [],
    }),
    mailer,
    secret: "test-secret-test-secret-test-secret-1234",
    required: true,
    dev: true,
    migrate: false,
  },
});

/** Cookie jar: one per simulated browser. */
function browser() {
  const cookies = new Map<string, string>();
  const headers = () => ({
    cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    origin: ORIGIN,
  });
  const absorb = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [k, v] = pair!.split("=");
      if (attrs.some((a) => /max-age=0/i.test(a))) cookies.delete(k!.trim());
      else cookies.set(k!.trim(), v ?? "");
    }
    return res;
  };
  return {
    async call<T = unknown>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; data: T }> {
      const res = absorb(
        await api.handle(
          new Request(`${ORIGIN}/admin/api${path}`, {
            method,
            headers: {
              ...headers(),
              ...(body ? { "content-type": "application/json" } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          }),
        ),
      );
      const text = await res.text();
      return {
        status: res.status,
        data: (text ? JSON.parse(text) : null) as T,
      };
    },
  };
}
type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  origin: string;
};
type Cfg = { user: User | null; auth: boolean; config: { auth?: unknown } };

type Err = { code?: string; error?: { code: string } };

const owner = browser();
const edBrowser = browser();
const lastMail = () => mailer.sent.at(-1)!;
const sendCode = (b: ReturnType<typeof browser>, email: string) =>
  b.call("POST", "/auth/email-otp/send-verification-otp", {
    email,
    type: "sign-in",
  });
const signIn = (b: ReturnType<typeof browser>, email: string, otp: string) =>
  b.call<Err>("POST", "/auth/sign-in/email-otp", { email, otp });
const currentUser = async (b: ReturnType<typeof browser>) =>
  (await b.call<Cfg>("GET", "/config")).data.user;

let me: User;
let ed: User;

describe("anonymous visitors", () => {
  it("get a trimmed config with no user", async () => {
    const { data } = await owner.call<Cfg>("GET", "/config");
    expect(data.user).toBeNull();
    expect(data.auth).toBe(true);
    expect(data.config.auth).toBeUndefined();
  });

  it("need to sign in for content", async () => {
    expect((await owner.call("GET", "/collections/pages")).status).toBe(401);
  });
});

describe("sign-in with an emailed code", () => {
  let ownerCode: string;
  let strangerAnswer: Awaited<ReturnType<typeof sendCode>>;

  it("sends no email to unknown addresses", async () => {
    strangerAnswer = await sendCode(owner, "stranger@example.org");
    expect(strangerAnswer.status).toBe(200);
    expect(mailer.sent).toHaveLength(0);
  });

  it("lets a config admin request a code before any invitation", async () => {
    const r = await sendCode(owner, "Owner@Example.org");
    // Same answer as for an unknown address, so it reveals nothing.
    expect(r).toEqual(strangerAnswer);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe("owner@example.org");
    ownerCode = codeFrom(mailer.sent[0]!.text);
  });

  it("rejects a wrong code", async () => {
    const r = await signIn(owner, "owner@example.org", "000000");
    expect(r.status).toBe(400);
    expect(r.data.code).toBe("INVALID_OTP");
  });

  it("signs in with the right code", async () => {
    expect((await signIn(owner, "owner@example.org", ownerCode)).status).toBe(
      200,
    );
    me = (await currentUser(owner))!;
    expect(me).toMatchObject({
      role: "admin",
      origin: "config",
      status: "active",
      name: "Owner", // defaults from the address
    });
  });

  it("accepts each code only once", async () => {
    expect((await signIn(owner, "owner@example.org", ownerCode)).status).toBe(
      400,
    );
  });
});

describe("invitations", () => {
  it("create an invited editor and email a link to the panel", async () => {
    const r = await owner.call<{ user: User }>("POST", "/users", {
      email: "Ed@Example.org",
      name: "Ed",
      role: "editor",
    });
    ed = r.data.user;
    expect(r.status).toBe(201);
    expect(r.data.user).toMatchObject({
      email: "ed@example.org",
      status: "invited",
    });
    expect(lastMail().subject).toContain("invited");
    expect(lastMail().text).toContain(`${ORIGIN}/admin`);
  });

  it("reject a duplicate address", async () => {
    const r = await owner.call("POST", "/users", {
      email: "ed@example.org",
      role: "editor",
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("are activated by the first sign-in", async () => {
    await sendCode(edBrowser, "ed@example.org");
    const r = await signIn(
      edBrowser,
      "ed@example.org",
      codeFrom(lastMail().text),
    );
    expect(r.status).toBe(200);
    expect(await currentUser(edBrowser)).toMatchObject({
      status: "active",
      role: "editor",
    });
  });
});

describe("editors", () => {
  it("cannot list or invite users", async () => {
    expect((await edBrowser.call("GET", "/users")).status).toBe(403);
    expect(
      (await edBrowser.call("POST", "/users", { email: "x@example.org" }))
        .status,
    ).toBe(403);
  });
});

describe("wrong guesses", () => {
  it("are refused five times, then burn the code", async () => {
    await sendCode(edBrowser, "ed@example.org");
    const code = codeFrom(lastMail().text);
    const guesses: (string | undefined)[] = [];
    for (let i = 0; i < 6; i++)
      guesses.push(
        (await signIn(edBrowser, "ed@example.org", "111111")).data.code,
      );
    expect(guesses).toEqual([
      ...Array(5).fill("INVALID_OTP"),
      "TOO_MANY_ATTEMPTS",
    ]);
    expect(
      (await signIn(edBrowser, "ed@example.org", code)).status,
    ).toBeGreaterThanOrEqual(400);
  });
});

describe("user management", () => {
  it("cannot demote a config admin", async () => {
    const r = await owner.call<Err>("PATCH", `/users/${me.id}`, {
      role: "editor",
    });
    expect(r.status).toBe(400);
    expect(r.data.error?.code).toBe("config_admin");
  });

  it("cannot remove yourself", async () => {
    expect((await owner.call("DELETE", `/users/${me.id}`)).status).toBe(400);
  });

  it("lets an admin change role and name", async () => {
    const r = await owner.call<{ user: User }>("PATCH", `/users/${ed.id}`, {
      role: "admin",
      name: "Edward",
    });
    expect(r.status).toBe(200);
    expect(r.data.user).toMatchObject({ role: "admin", name: "Edward" });
  });

  it("re-sends an invitation", async () => {
    expect((await owner.call("POST", `/users/${ed.id}/invite`)).status).toBe(
      200,
    );
    expect(lastMail().to).toBe("ed@example.org");
  });

  it("removes a user and ends their session", async () => {
    expect((await owner.call("DELETE", `/users/${ed.id}`)).status).toBe(200);
    expect(await currentUser(edBrowser)).toBeNull();
    const { data } = await owner.call<{ users: User[] }>("GET", "/users");
    expect(data.users).toHaveLength(1);
  });

  it("treats removing an already-removed user as done", async () => {
    expect((await owner.call("DELETE", `/users/${ed.id}`)).status).toBe(200);
  });

  // Only Vestry's guarded /users routes are reachable, not Better Auth's.
  it("closes Better Auth's raw admin endpoints", async () => {
    const r = await owner.call("POST", "/auth/admin/set-role", {
      userId: me.id,
      role: "editor",
    });
    expect(r.status).toBe(404);
    expect((await currentUser(owner))!.role).toBe("admin");
  });
});

describe("sessions", () => {
  it("refuse cross-site writes", async () => {
    const res = await api.handle(
      new Request(`${ORIGIN}/admin/api/users`, {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("end on sign-out", async () => {
    expect((await owner.call("POST", "/auth/sign-out", {})).status).toBe(200);
    expect(await currentUser(owner)).toBeNull();
  });
});

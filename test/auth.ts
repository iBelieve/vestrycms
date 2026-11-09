/**
 * Exercises sign-in and user management end to end through the HTTP API,
 * with Better Auth on its memory adapter and a capturing mailer. Run with
 * `pnpm test`.
 */
import { memoryAdapter } from "better-auth/adapters/memory";
import { createApi } from "../src/core/api.js";
import { memoryMailer } from "../src/core/mail.js";
import { LocalSource } from "../src/core/sources/local.js";
import type { VestryConfig } from "../src/config/types.js";

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok   ${msg}`);
};
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

const owner = browser();

// Anonymous: trimmed config, no user.
const anon = await owner.call<Cfg>("GET", "/config");
assert(
  anon.data.user === null && anon.data.auth === true,
  "anonymous config has no user",
);
assert(
  anon.data.config.auth === undefined,
  "anonymous config hides the admin list",
);
assert(
  (await owner.call("GET", "/collections/pages")).status === 401,
  "content needs sign-in",
);

// Unknown addresses get the same answer but no email.
let r = await owner.call("POST", "/auth/email-otp/send-verification-otp", {
  email: "stranger@example.org",
  type: "sign-in",
});
assert(
  r.status === 200 && mailer.sent.length === 0,
  "unknown address gets no email",
);

// A config admin can sign in before anyone invited them.
r = await owner.call("POST", "/auth/email-otp/send-verification-otp", {
  email: "Owner@Example.org",
  type: "sign-in",
});
assert(
  r.status === 200 &&
    mailer.sent.length === 1 &&
    mailer.sent[0]!.to === "owner@example.org",
  "config admin gets a code",
);
const ownerCode = codeFrom(mailer.sent[0]!.text);
r = await owner.call<{ code?: string }>("POST", "/auth/sign-in/email-otp", {
  email: "owner@example.org",
  otp: "000000",
});
assert(
  r.status === 400 && (r.data as { code?: string }).code === "INVALID_OTP",
  "wrong code rejected",
);
r = await owner.call("POST", "/auth/sign-in/email-otp", {
  email: "owner@example.org",
  otp: ownerCode,
});
assert(r.status === 200, "right code signs in");
let me = (await owner.call<Cfg>("GET", "/config")).data.user!;
assert(
  me.role === "admin" && me.origin === "config" && me.status === "active",
  "owner is an active config admin",
);
assert(me.name === "Owner", "name defaults from the address");
r = await owner.call("POST", "/auth/sign-in/email-otp", {
  email: "owner@example.org",
  otp: ownerCode,
});
assert(r.status === 400, "code is single-use");

// Invitations.
r = await owner.call<{ user: User }>("POST", "/users", {
  email: "Ed@Example.org",
  name: "Ed",
  role: "editor",
});
assert(
  r.status === 201 &&
    r.data.user.email === "ed@example.org" &&
    r.data.user.status === "invited",
  "invite creates an invited editor",
);
assert(
  mailer.sent.at(-1)!.subject.includes("invited") &&
    mailer.sent.at(-1)!.text.includes(`${ORIGIN}/admin`),
  "invitation email links to the panel",
);
r = await owner.call("POST", "/users", {
  email: "ed@example.org",
  role: "editor",
});
assert(r.status >= 400, "duplicate invite rejected");
const ed = (
  await owner.call<{ users: User[] }>("GET", "/users")
).data.users.find((u) => u.email === "ed@example.org")!;

// The editor signs in; editors cannot manage users.
const edBrowser = browser();
await edBrowser.call("POST", "/auth/email-otp/send-verification-otp", {
  email: "ed@example.org",
  type: "sign-in",
});
r = await edBrowser.call("POST", "/auth/sign-in/email-otp", {
  email: "ed@example.org",
  otp: codeFrom(mailer.sent.at(-1)!.text),
});
assert(r.status === 200, "invited editor signs in");
const edMe = (await edBrowser.call<Cfg>("GET", "/config")).data.user!;
assert(
  edMe.status === "active" && edMe.role === "editor",
  "first sign-in activates the user",
);
assert(
  (await edBrowser.call("GET", "/users")).status === 403,
  "editors cannot list users",
);
assert(
  (await edBrowser.call("POST", "/users", { email: "x@example.org" }))
    .status === 403,
  "editors cannot invite",
);

// Wrong guesses: five are refused as invalid, then the code is burned.
await edBrowser.call("POST", "/auth/email-otp/send-verification-otp", {
  email: "ed@example.org",
  type: "sign-in",
});
const burnCode = codeFrom(mailer.sent.at(-1)!.text);
const guesses: (string | undefined)[] = [];
for (let i = 0; i < 6; i++) {
  r = await edBrowser.call<{ code?: string }>(
    "POST",
    "/auth/sign-in/email-otp",
    { email: "ed@example.org", otp: "111111" },
  );
  guesses.push((r.data as { code?: string }).code);
}
assert(
  guesses.slice(0, 5).every((c) => c === "INVALID_OTP") &&
    guesses[5] === "TOO_MANY_ATTEMPTS",
  "five wrong guesses are invalid, the sixth burns the code",
);
r = await edBrowser.call("POST", "/auth/sign-in/email-otp", {
  email: "ed@example.org",
  otp: burnCode,
});
assert(r.status >= 400, "burned code no longer works");

// Role management guards.
r = await owner.call("PATCH", `/users/${me.id}`, { role: "editor" });
assert(
  r.status === 400 &&
    (r.data as { error: { code: string } }).error.code === "config_admin",
  "config admin cannot be demoted",
);
r = await owner.call("DELETE", `/users/${me.id}`);
assert(r.status === 400, "cannot remove yourself");
r = await owner.call<{ user: User }>("PATCH", `/users/${ed.id}`, {
  role: "admin",
  name: "Edward",
});
assert(
  r.status === 200 &&
    r.data.user.role === "admin" &&
    r.data.user.name === "Edward",
  "admin can change role and name",
);
r = await owner.call("POST", `/users/${ed.id}/invite`);
assert(
  r.status === 200 && mailer.sent.at(-1)!.to === "ed@example.org",
  "invitation can be re-sent",
);
r = await owner.call("DELETE", `/users/${ed.id}`);
assert(r.status === 200, "admin can remove a user");
assert(
  (await edBrowser.call<Cfg>("GET", "/config")).data.user === null,
  "removed user's session is gone",
);
assert(
  (await owner.call<{ users: User[] }>("GET", "/users")).data.users.length ===
    1,
  "directory lists remaining users",
);

// Better Auth's admin endpoints are not reachable directly; only Vestry's
// guarded /users routes are.
r = await owner.call("POST", "/auth/admin/set-role", {
  userId: me.id,
  role: "editor",
});
assert(r.status === 404, "raw admin endpoints are closed");
assert(
  (await owner.call<Cfg>("GET", "/config")).data.user!.role === "admin",
  "role unchanged by the closed endpoint",
);
r = await owner.call("DELETE", `/users/${ed.id}`);
assert(r.status === 200, "removing an already-removed user is idempotent");

// Cross-site writes are refused; sign-out ends the session.
const evil = await api.handle(
  new Request(`${ORIGIN}/admin/api/users`, {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "content-type": "application/json",
    },
    body: "{}",
  }),
);
assert(evil.status === 403, "cross-site write refused");
r = await owner.call("POST", "/auth/sign-out", {});
assert(r.status === 200, "sign-out succeeds");
assert(
  (await owner.call<Cfg>("GET", "/config")).data.user === null,
  "sign-out destroys the session",
);

console.log("\nauth: all good");

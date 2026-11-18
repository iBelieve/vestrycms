/**
 * Sign-in and users, on Better Auth. Editors sign in with a one-time code
 * emailed to them (the email OTP plugin); admins manage users through the
 * admin plugin. Vestry adds: config-listed bootstrap admins, invitations,
 * and a `lastLoginAt` field.
 *
 * Storage is whatever Better Auth accepts: a Cloudflare D1 binding in
 * production, a `node:sqlite` database in development, the memory adapter
 * in tests. Tables are created on first use with Better Auth's migrator.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { admin, emailOTP } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";
import type { Mailer } from "./mail.js";
import { isRole, type PublicUser, type Role } from "./roles.js";

export type AuthDatabase = NonNullable<BetterAuthOptions["database"]>;

export interface VestryAuthOptions {
  database: AuthDatabase;
  mailer: Mailer;
  /** Signs cookies and hashes codes. Required outside development. */
  secret: string;
  /** Origin the panel is served from, e.g. `https://example.org`. */
  baseURL: string;
  /** Path Better Auth's routes are mounted at, e.g. `/admin/api/auth`. */
  basePath: string;
  /** Cookie path, so the session cookie only travels with control-panel requests. */
  cookiePath?: string;
  /** Name of the site, used in emails. */
  siteName: string;
  /** Absolute URL of the control panel, used in invitation emails. */
  adminUrl: string;
  /** Addresses that are always admins (from the config). */
  admins?: string[];
  /** Development: no rate limiting, cookies without `Secure`. */
  dev?: boolean;
  /** Create or update the tables on first use (Kysely-backed databases only). */
  migrate?: boolean;
  /** Prefix for the table names, so several sites can share one database. */
  tablePrefix?: string;
}

/** Vestry's two roles in Better Auth's access-control terms: admins manage users, editors don't. */
const ac = createAccessControl(defaultStatements);
const roles = {
  // Only what the Users page needs: no impersonation, bans or passwords.
  admin: ac.newRole({
    user: ["create", "list", "get", "update", "set-role", "delete"],
  }),
  editor: ac.newRole({ user: [] }),
};

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const CODE_TTL_SECONDS = 10 * 60;
const CODE_TTL_MINUTES = Math.round(CODE_TTL_SECONDS / 60);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Display name fallback: the part before the `@`, title-cased a little. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const pretty = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(" ");
  // Commit authors need a non-empty name; fall back to the address itself.
  return pretty || local || email;
}

/** The tables Better Auth (with Vestry's plugins) keeps. */
export const AUTH_TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "rateLimit",
] as const;

// Lowercase only: SQLite (and so D1) table names ignore case, so `Site_`
// and `site_` would silently name the same tables.
const TABLE_PREFIX = /^[a-z][a-z0-9_]*$/;

/** Why a `tablePrefix` is unusable, or undefined when it is fine. */
export function tablePrefixError(prefix: string | undefined) {
  if (prefix === undefined || prefix === "" || TABLE_PREFIX.test(prefix))
    return undefined;
  return `auth.tablePrefix ${JSON.stringify(prefix)} must be lowercase letters, digits and underscores, starting with a letter.`;
}

/**
 * Migrations run once per database and table prefix per isolate, whichever
 * origin asked first (the instances per origin share the database).
 */
const migratedByDatabase = new WeakMap<object, Map<string, Promise<void>>>();

export function createVestryAuth(opts: VestryAuthOptions) {
  const admins = (opts.admins ?? []).map(normalizeEmail);
  const isConfigAdmin = (email: string) =>
    admins.includes(normalizeEmail(email));

  const prefixError = tablePrefixError(opts.tablePrefix);
  if (prefixError) throw new Error(prefixError);
  const prefix = opts.tablePrefix ?? "";
  const modelName = (table: (typeof AUTH_TABLES)[number]) =>
    prefix ? { modelName: `${prefix}${table}` } : {};

  const auth = betterAuth({
    appName: opts.siteName,
    secret: opts.secret,
    baseURL: opts.baseURL,
    basePath: opts.basePath,
    database: opts.database,
    session: {
      ...modelName("session"),
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 60 * 60 * 24,
    },
    account: modelName("account"),
    verification: modelName("verification"),
    rateLimit: {
      ...modelName("rateLimit"),
      enabled: !opts.dev,
      storage: "database",
    },
    advanced: {
      cookiePrefix: "vestry",
      useSecureCookies: opts.baseURL.startsWith("https://"),
      defaultCookieAttributes: { path: opts.cookiePath ?? "/" },
      // Cloudflare puts the client address in cf-connecting-ip; the default
      // x-forwarded-for is absent or client-controlled there, which would
      // collapse the rate limiter into one shared bucket.
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
      },
    },
    user: {
      ...modelName("user"),
      additionalFields: {
        lastLoginAt: { type: "date", required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session, ctx) => {
            if (!ctx) return;
            if ((session as { impersonatedBy?: string | null }).impersonatedBy)
              return;
            await ctx.context.internalAdapter.updateUser(session.userId, {
              lastLoginAt: new Date(),
            });
          },
        },
      },
    },
    hooks: {
      // The first admin has nobody to invite them. Addresses listed in the
      // config are created on their first sign-in attempt, so the OTP plugin
      // (which refuses unknown addresses) finds them.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/email-otp/send-verification-otp") return;
        const email = normalizeEmail(String(ctx.body?.email ?? ""));
        if (!isConfigAdmin(email)) return;
        const existing =
          await ctx.context.internalAdapter.findUserByEmail(email);
        if (existing) {
          const role = (existing.user as { role?: string }).role;
          if (role !== "admin") {
            await ctx.context.internalAdapter.updateUser(existing.user.id, {
              role: "admin",
            });
          }
          return;
        }
        await ctx.context.internalAdapter.createUser(
          {
            email,
            name: nameFromEmail(email),
            emailVerified: false,
            role: "admin",
          },
          { method: "email-otp" },
        );
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: CODE_TTL_SECONDS,
        allowedAttempts: 5,
        // Encrypted with the secret, so a database dump alone can't be
        // brute-forced against a six-digit code.
        storeOTP: "encrypted",
        // Only existing users (and config admins, created above) may sign in.
        disableSignUp: true,
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in") return;
          await opts.mailer.send({
            to: email,
            ...loginCodeEmail(opts.siteName, otp),
          });
        },
      }),
      admin({
        ac,
        roles,
        defaultRole: "editor",
        adminRoles: ["admin"],
      }),
    ],
  });

  const ensureMigrated = () => {
    if (opts.migrate === false) return Promise.resolve();
    const key = opts.database as object;
    let byPrefix = migratedByDatabase.get(key);
    if (!byPrefix) migratedByDatabase.set(key, (byPrefix = new Map()));
    const pending = byPrefix.get(prefix);
    if (pending) return pending;
    const run = (async () => {
      const { runMigrations, unsafeChanges } = await getMigrations(
        auth.options,
        { throwOnUnsafe: false },
      );
      for (const change of unsafeChanges ?? []) {
        console.warn(
          `[vestry] auth schema needs a manual migration: ${change}`,
        );
      }
      try {
        await runMigrations();
      } catch (e) {
        // Another isolate created the same table or index a moment earlier.
        if (!/already exists/i.test(e instanceof Error ? e.message : String(e)))
          throw e;
      }
    })().catch((e) => {
      byPrefix.delete(prefix);
      throw e;
    });
    byPrefix.set(prefix, run);
    return run;
  };

  /** The `PublicUser` view of a Better Auth user record. */
  const toPublicUser = (user: {
    id: string;
    email: string;
    name: string;
    role?: string | null;
    emailVerified?: boolean;
    createdAt: Date | string;
    lastLoginAt?: Date | string | null;
  }): PublicUser => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: isRole(user.role) ? user.role : "editor",
    // Better Auth marks the address verified on the first successful code.
    status: user.emailVerified ? "active" : "invited",
    origin: isConfigAdmin(user.email) ? "config" : "invite",
    createdAt: toIso(user.createdAt),
    ...(user.lastLoginAt ? { lastLoginAt: toIso(user.lastLoginAt) } : {}),
  });

  const sendInvite = (by: { name: string }, user: PublicUser) =>
    opts.mailer.send({
      to: user.email,
      ...inviteEmail(opts.siteName, opts.adminUrl, by.name, user),
    });

  return { auth, ensureMigrated, toPublicUser, isConfigAdmin, sendInvite };
}

export type VestryAuth = ReturnType<typeof createVestryAuth>;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

// ------------------------------------------------------------------ emails

function loginCodeEmail(siteName: string, code: string) {
  const pretty = `${code.slice(0, 3)} ${code.slice(3)}`;
  return {
    subject: `${code} is your ${siteName} sign-in code`,
    text: [
      `Your sign-in code for ${siteName} is:`,
      "",
      `    ${pretty}`,
      "",
      `It expires in ${CODE_TTL_MINUTES} minutes. If you didn't request it, you can ignore this email.`,
    ].join("\n"),
    html: emailHtml(
      `Your sign-in code for <strong>${escapeHtml(siteName)}</strong> is:`,
      `<p style="font-size:32px;letter-spacing:6px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin:20px 0">${escapeHtml(pretty)}</p>`,
      `It expires in ${CODE_TTL_MINUTES} minutes. If you didn't request it, you can ignore this email.`,
    ),
  };
}

function inviteEmail(
  siteName: string,
  adminUrl: string,
  inviterName: string,
  user: PublicUser,
) {
  return {
    subject: `You've been invited to edit ${siteName}`,
    text: [
      `${inviterName} invited you to edit ${siteName} as ${roleLabel(user.role)}.`,
      "",
      `Sign in at ${adminUrl} with this email address (${user.email}). We'll email you a code each time you sign in; there's no password.`,
    ].join("\n"),
    html: emailHtml(
      `${escapeHtml(inviterName)} invited you to edit <strong>${escapeHtml(siteName)}</strong> as ${roleLabel(user.role)}.`,
      `<p style="margin:20px 0"><a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#c2410c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open ${escapeHtml(siteName)}</a></p>`,
      `Sign in with this email address (${escapeHtml(user.email)}). We'll email you a code each time you sign in; there's no password.`,
    ),
  };
}

function roleLabel(role: Role): string {
  return role === "admin" ? "an admin" : "an editor";
}

function emailHtml(lead: string, middle: string, trailer: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937"><div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 32px"><p style="margin:0 0 4px;font-size:16px">${lead}</p>${middle}<p style="margin:0;color:#6b7280;font-size:14px">${trailer}</p></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

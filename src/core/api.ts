/**
 * The Vestry HTTP API. Runtime-agnostic: takes a `Request`, returns a
 * `Response`. The Astro route and the dev-server middleware both delegate here.
 */
import type { VestryConfig } from "../config/types.js";
import { isAPIError } from "better-auth/api";
import {
  createVestryAuth,
  nameFromEmail,
  normalizeEmail,
  tablePrefixError,
  type AuthDatabase,
  type VestryAuth,
} from "./auth.js";
import type { Cache } from "./cache.js";
import type { BuildIndex } from "./index-types.js";
import { MailError, consoleMailer, resendMailer, type Mailer } from "./mail.js";
import { isRole, type PublicUser, type Role } from "./roles.js";
import { ContentService, type SaveEntryInput } from "./service.js";
import { SourceError, withAuthor, type ContentSource } from "./source.js";
import { GitHubSource } from "./sources/github.js";
import { installationTokenProvider } from "./sources/github-app.js";
import { extname, normalizePath } from "./paths.js";

export type EnvReader = (key: string) => string | undefined;

export interface ApiOptions {
  config: VestryConfig;
  index: BuildIndex;
  /** URL path the control panel is mounted at, e.g. `/admin`. */
  basePath: string;
  env: EnvReader;
  /** Edit the project directory instead of the repository (dev). */
  localSource?: ContentSource;
  /**
   * Sign-in settings. Production resolves the database from the D1 binding,
   * the mailer from `config.mail` and the secret from `VESTRY_SECRET`; dev
   * and tests inject their own. With a local source sign-in is skipped
   * unless `required` is set.
   */
  auth?: {
    database?: AuthDatabase;
    mailer?: Mailer;
    secret?: string;
    required?: boolean;
    /** Development: no rate limiting, a fixed fallback secret. */
    dev?: boolean;
    /** Create the tables on first use (default true). */
    migrate?: boolean;
  };
  /** Name of the binding holding the D1 database for users and sessions. */
  databaseBinding?: string;
  cache?: Cache;
  /** Hook that lets hosts supply the remote source (defaults to GitHub via a GitHub App). */
  createSource?: () => ContentSource;
}

/** Per-request context the host passes along (Cloudflare bindings, etc.). */
export interface RequestContext {
  bindings?: Record<string, unknown>;
}

export interface ClientConfig {
  config: VestryConfig;
  basePath: string;
  mode: "local" | "github";
  /** Whether sign-in is required (false in plain local mode). */
  auth: boolean;
  source: { label: string; branch?: string; url?: string };
  user: PublicUser | null;
  /** Set when the host is missing bindings or secrets. */
  setupError?: string;
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  mdx: "text/markdown; charset=utf-8",
};

export const DEFAULT_DATABASE_BINDING = "VESTRY_DB";

/** Better Auth routes the panel uses; everything else under /auth is closed. */
const AUTH_ROUTES = new Set([
  "/email-otp/send-verification-otp",
  "/sign-in/email-otp",
  "/sign-out",
  "/get-session",
  "/ok",
]);
const DEV_SECRET = "vestry-development-secret-do-not-use-in-production";

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function error(message: string, status = 400, code = "error"): Response {
  return json({ error: { message, code } }, { status });
}

const notFound = () => error("Not found", 404, "not_found");

/**
 * The request's JSON body. Malformed JSON is the client's mistake, unlike a
 * `SyntaxError` from parsing a file in the repository, which is ours.
 */
async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch (e) {
    if (e instanceof SyntaxError)
      throw new SourceError(
        `Invalid request: ${e.message}`,
        400,
        "bad_request",
      );
    throw e;
  }
}

const LOCAL_USER: PublicUser = {
  id: "local",
  email: "",
  name: "Local development",
  role: "admin",
  status: "active",
  origin: "config",
  createdAt: "",
};

export function createApi(options: ApiOptions) {
  const { config, basePath } = options;
  const apiPrefix = `${basePath.replace(/\/$/, "")}/api`;
  const cookiePath = basePath.replace(/\/$/, "") || "/";
  const authRequired = !options.localSource || options.auth?.required === true;
  const databaseBinding = options.databaseBinding ?? DEFAULT_DATABASE_BINDING;
  let remoteSource: ContentSource | undefined;
  /**
   * One Better Auth instance per request origin: production has one, dev may
   * have a couple (localhost vs 127.0.0.1). Bounded because the Host header
   * is client-controlled on some hosts.
   */
  const authByOrigin = new Map<string, VestryAuth>();
  const MAX_ORIGINS = 4;

  // ----------------------------------------------------------- resolvers

  function resolveMailer(): Mailer | { error: string } {
    if (options.auth?.mailer) return options.auth.mailer;
    const mail = config.mail;
    if (!mail) {
      return {
        error:
          "config.mail is not set. Vestry needs an email provider to send sign-in codes.",
      };
    }
    if (mail.provider === "console") return consoleMailer();
    const apiKey = options.env("VESTRY_RESEND_API_KEY");
    if (!apiKey)
      return { error: "Missing environment variable: VESTRY_RESEND_API_KEY" };
    return resendMailer({ apiKey, from: mail.from });
  }

  function resolveDatabase(
    ctx: RequestContext,
  ): AuthDatabase | { error: string } {
    if (options.auth?.database) return options.auth.database;
    const binding = ctx.bindings?.[databaseBinding];
    if (isD1Like(binding)) return binding as AuthDatabase;
    return {
      error: `No ${databaseBinding} D1 binding. Add it to wrangler.jsonc so Vestry can store users and sessions.`,
    };
  }

  function resolveSecret(): string | { error: string } {
    const secret = options.auth?.secret ?? options.env("VESTRY_SECRET");
    if (secret) return secret;
    if (options.auth?.dev) return DEV_SECRET;
    return {
      error:
        "Missing environment variable: VESTRY_SECRET (a random string, e.g. `openssl rand -hex 32`).",
    };
  }

  function resolveAuth(
    url: URL,
    ctx: RequestContext,
  ): VestryAuth | { error: string } {
    const cached = authByOrigin.get(url.origin);
    if (cached) return cached;
    const database = resolveDatabase(ctx);
    if ("error" in database) return database;
    const mailer = resolveMailer();
    if ("error" in mailer) return mailer;
    const secret = resolveSecret();
    if (typeof secret !== "string") return secret;
    const tablePrefix = config.auth?.tablePrefix;
    const prefixError = tablePrefixError(tablePrefix);
    if (prefixError) return { error: prefixError };
    // Invitation links point at the configured site, not whatever host the
    // inviting admin happened to use (a preview or workers.dev URL).
    const siteOrigin =
      !options.auth?.dev && config.siteUrl
        ? config.siteUrl.replace(/\/$/, "")
        : url.origin;
    const created = createVestryAuth({
      database,
      mailer,
      secret,
      baseURL: url.origin,
      basePath: `${apiPrefix}/auth`,
      cookiePath,
      siteName: config.name ?? "Vestry",
      adminUrl: `${siteOrigin}${basePath}`,
      admins: config.auth?.admins ?? [],
      dev: options.auth?.dev,
      migrate: options.auth?.migrate,
      tablePrefix,
    });
    if (authByOrigin.size >= MAX_ORIGINS) {
      const oldest = authByOrigin.keys().next().value;
      if (oldest !== undefined) authByOrigin.delete(oldest);
    }
    authByOrigin.set(url.origin, created);
    return created;
  }

  function resolveSource(): ContentSource | { error: string } {
    if (options.localSource) return options.localSource;
    if (remoteSource) return remoteSource;
    if (options.createSource) return (remoteSource = options.createSource());
    const appId = options.env("VESTRY_GITHUB_APP_ID");
    const installationId = options.env("VESTRY_GITHUB_INSTALLATION_ID");
    const privateKey = options.env("VESTRY_GITHUB_PRIVATE_KEY");
    const missing = [
      !appId && "VESTRY_GITHUB_APP_ID",
      !installationId && "VESTRY_GITHUB_INSTALLATION_ID",
      !privateKey && "VESTRY_GITHUB_PRIVATE_KEY",
    ].filter(Boolean);
    if (missing.length) {
      return { error: `Missing environment variables: ${missing.join(", ")}` };
    }
    return (remoteSource = new GitHubSource({
      owner: config.repo.owner,
      repo: config.repo.name,
      branch: config.repo.branch,
      token: installationTokenProvider({
        appId: appId!,
        installationId: installationId!,
        privateKey: privateKey!,
      }),
      cache: options.cache,
    }));
  }

  // ---------------------------------------------------------------- handle

  async function handle(
    request: Request,
    ctx: RequestContext = {},
  ): Promise<Response> {
    // Better Auth may refresh the session while we check it; its Set-Cookie
    // headers are collected here and added to whatever response goes out.
    const cookies: string[] = [];
    const response = await dispatch(request, ctx, cookies);
    if (!cookies.length) return response;
    const out = new Response(response.body, response);
    for (const cookie of cookies) out.headers.append("Set-Cookie", cookie);
    return out;
  }

  async function dispatch(
    request: Request,
    ctx: RequestContext,
    cookies: string[],
  ): Promise<Response> {
    const route = parseRoute(request, apiPrefix);
    if (route instanceof Response) return route;
    try {
      return await routeRequest(request, ctx, cookies, route);
    } catch (e) {
      return errorResponse(e);
    }
  }

  async function routeRequest(
    request: Request,
    ctx: RequestContext,
    cookies: string[],
    route: Route,
  ): Promise<Response> {
    const { url, segments, method } = route;
    // Everything that needs sign-in shares one setup check.
    const signIn = await signInSetup(url, ctx);

    // Better Auth owns sign-in under /auth: sending and checking codes,
    // sessions, sign-out. Only the routes the panel uses are reachable;
    // the admin plugin's endpoints stay behind Vestry's /users routes so
    // their guards (config admins, last admin) cannot be bypassed.
    if (segments[0] === "auth") return authRoute(request, segments, signIn);

    const user = await currentUser(request, signIn.vestryAuth, cookies);
    if (segments[0] === "config" && method === "GET")
      return configRoute(user, signIn.setupError);

    // The logo is shown on the sign-in page, so it is public.
    if (isLogoRequest(route)) {
      const source = resolveSource();
      if ("error" in source) return error(source.error, 500, "setup");
      return serveFile(
        new ContentService(config, source, options.index),
        config.logo!,
        request,
      );
    }

    if (!user) {
      const { setupError } = signIn;
      return error(
        setupError ?? "Sign in required",
        401,
        setupError ? "setup" : "unauthorized",
      );
    }

    if (segments[0] === "users") {
      return usersRoute(request, route, user, signIn);
    }

    const baseSource = resolveSource();
    if ("error" in baseSource) return error(baseSource.error, 500, "setup");
    const source = user.email
      ? withAuthor(baseSource, { name: user.name, email: user.email })
      : baseSource;
    return contentRoute(
      request,
      route,
      source,
      new ContentService(config, source, options.index),
    );
  }

  async function signInSetup(url: URL, ctx: RequestContext): Promise<SignIn> {
    if (!authRequired) return { vestryAuth: null };
    const resolved = resolveAuth(url, ctx);
    if ("error" in resolved)
      return { vestryAuth: null, setupError: resolved.error };
    await resolved.ensureMigrated();
    return { vestryAuth: resolved };
  }

  function authRoute(
    request: Request,
    segments: string[],
    { vestryAuth, setupError }: SignIn,
  ): Response | Promise<Response> {
    if (!authRequired)
      return error("Sign-in is not used in local mode", 400, "local_mode");
    if (!vestryAuth) return error(setupError!, 500, "setup");
    const authPath = `/${segments.slice(1).join("/")}`;
    if (!AUTH_ROUTES.has(authPath)) return notFound();
    return vestryAuth.auth.handler(request);
  }

  /** The signed-in user (refreshing their session), or the local user. */
  async function currentUser(
    request: Request,
    vestryAuth: VestryAuth | null,
    cookies: string[],
  ): Promise<PublicUser | null> {
    if (!vestryAuth) return authRequired ? null : LOCAL_USER;
    const { headers, response: session } = await vestryAuth.auth.api.getSession(
      { headers: request.headers, returnHeaders: true },
    );
    cookies.push(...headers.getSetCookie());
    return session ? vestryAuth.toPublicUser(session.user) : null;
  }

  function configRoute(
    user: PublicUser | null,
    setupError: string | undefined,
  ): Response {
    const source = resolveSource();
    const info = "error" in source ? null : source.info();
    const payload: ClientConfig = {
      config: user ? clientConfig(config) : publicConfig(config),
      basePath,
      mode: options.localSource ? "local" : "github",
      auth: authRequired,
      source: info
        ? { label: info.label, branch: info.branch, url: info.url }
        : {
            label: `${config.repo.owner}/${config.repo.name}`,
            branch: config.repo.branch,
            url: `https://github.com/${config.repo.owner}/${config.repo.name}`,
          },
      user,
      setupError: setupError ?? ("error" in source ? source.error : undefined),
    };
    return json(payload);
  }

  function isLogoRequest({ url, segments, method }: Route): boolean {
    return (
      segments[0] === "file" &&
      method === "GET" &&
      Boolean(config.logo) &&
      normalizePath(url.searchParams.get("path") ?? "") ===
        normalizePath(config.logo!)
    );
  }

  function usersRoute(
    request: Request,
    { segments, method }: Route,
    user: PublicUser,
    { vestryAuth, setupError }: SignIn,
  ): Promise<Response> | Response {
    if (!vestryAuth) {
      return error(
        setupError ?? "User management is not available in local mode",
        400,
        setupError ? "setup" : "local_mode",
      );
    }
    if (user.role !== "admin")
      return error("Only admins can manage users.", 403, "forbidden");
    const admin = userAdmin(vestryAuth, request.headers, user);
    const id = segments[1];
    if (segments.length === 1 && method === "GET") return listUsers(admin);
    if (segments.length === 1 && method === "POST")
      return inviteUser(admin, request);
    if (id && segments.length === 2 && method === "PATCH")
      return updateUser(admin, request, id);
    if (id && segments.length === 2 && method === "DELETE")
      return removeUser(admin, id);
    if (id && segments[2] === "invite" && method === "POST")
      return resendInvite(admin, id);
    return notFound();
  }

  return { handle, apiPrefix };
}

/** An API request: its URL, its path below the API and its method. */
interface Route {
  url: URL;
  segments: string[];
  method: string;
}

/** Whether sign-in is set up, and if not, why. */
interface SignIn {
  vestryAuth: VestryAuth | null;
  setupError?: string;
}

/** The route of a request, or the response that refuses it. */
function parseRoute(request: Request, apiPrefix: string): Route | Response {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(apiPrefix)) return notFound();
  const rel = url.pathname.slice(apiPrefix.length);
  let segments: string[];
  try {
    segments = rel.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return error("Malformed path", 400, "bad_request");
  }
  const method = request.method.toUpperCase();
  // Cross-site writes are refused outright; the SameSite cookie already
  // keeps other sites' requests anonymous, this is the second lock.
  if (method !== "GET" && method !== "HEAD" && isCrossSite(request, url))
    return error("Cross-site request refused", 403, "cross_site");
  return { url, segments, method };
}

function isCrossSite(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  return (
    Boolean(origin && origin !== url.origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  );
}

function errorResponse(e: unknown): Response {
  if (isAPIError(e)) {
    const body = e.body as { message?: string; code?: string } | undefined;
    return error(
      body?.message ?? e.message,
      e.statusCode,
      body?.code?.toLowerCase() ?? "auth_error",
    );
  }
  if (e instanceof SourceError) return error(e.message, e.status, e.code);
  if (e instanceof MailError) return error(e.message, 502, "mail");
  console.error("[vestry] API error", e);
  return error(
    e instanceof Error ? e.message : "Unexpected error",
    500,
    "internal",
  );
}

// ------------------------------------------------------------------ users

/** What the /users routes work with: Better Auth's admin API, as the admin. */
interface UserAdmin {
  vestryAuth: VestryAuth;
  headers: Headers;
  /** The signed-in admin. */
  user: PublicUser;
  getUser(id: string): Promise<PublicUser | null>;
  adminCount(): Promise<number>;
}

function userAdmin(
  vestryAuth: VestryAuth,
  headers: Headers,
  user: PublicUser,
): UserAdmin {
  const { auth, toPublicUser } = vestryAuth;
  return {
    vestryAuth,
    headers,
    user,
    async getUser(id) {
      try {
        const found = await auth.api.getUser({ query: { id }, headers });
        return found ? toPublicUser(found) : null;
      } catch (e) {
        if (isAPIError(e) && e.statusCode === 404) return null;
        throw e;
      }
    },
    async adminCount() {
      const { total } = await auth.api.listUsers({
        query: { filterField: "role", filterValue: "admin", limit: 1 },
        headers,
      });
      return total;
    },
  };
}

async function listUsers({ vestryAuth, headers }: UserAdmin) {
  const { users } = await vestryAuth.auth.api.listUsers({
    query: { limit: 1000, sortBy: "name", sortDirection: "asc" },
    headers,
  });
  return json({ users: users.map(vestryAuth.toPublicUser) });
}

async function inviteUser(
  { vestryAuth, headers, user }: UserAdmin,
  request: Request,
): Promise<Response> {
  const { auth, toPublicUser, isConfigAdmin, sendInvite } = vestryAuth;
  const body = await readJson<{
    email?: string;
    name?: unknown;
    role?: Role;
  }>(request);
  const email = normalizeEmail(String(body.email ?? ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return error("Enter a valid email address.", 400, "invalid_email");
  const role: Role = isRole(body.role) ? body.role : "editor";
  const created = await auth.api.createUser({
    body: {
      email,
      name: trimmedName(body.name) || nameFromEmail(email),
      role: isConfigAdmin(email) ? "admin" : role,
    },
    headers,
  });
  const invited = toPublicUser(created.user);
  // The user exists from here on; a failed email must not hide them.
  let mailError: string | undefined;
  try {
    await sendInvite(user, invited);
  } catch (e) {
    mailError = e instanceof Error ? e.message : String(e);
    console.error("[vestry] invitation email failed", e);
  }
  return json({ user: invited, mailError }, { status: 201 });
}

async function updateUser(
  admin: UserAdmin,
  request: Request,
  id: string,
): Promise<Response> {
  const { auth } = admin.vestryAuth;
  const { headers } = admin;
  const body = await readJson<{ name?: unknown; role?: Role }>(request);
  const target = await admin.getUser(id);
  if (!target) return error("User not found.", 404, "not_found");
  if (body.role !== undefined && body.role !== target.role) {
    const refusal = await roleChangeRefusal(admin, target, body.role);
    if (refusal) return refusal;
    await auth.api.setRole({ body: { userId: id, role: body.role }, headers });
  }
  const name = trimmedName(body.name);
  if (name) {
    await auth.api.adminUpdateUser({
      body: { userId: id, data: { name } },
      headers,
    });
  }
  return json({ user: await admin.getUser(id) });
}

/** A name from a request body, trimmed; empty unless it is a string. */
function trimmedName(name: unknown): string {
  return typeof name === "string" ? name.trim() : "";
}

/** Why a user's role cannot change to `role`, if it cannot. */
async function roleChangeRefusal(
  admin: UserAdmin,
  target: PublicUser,
  role: unknown,
): Promise<Response | null> {
  if (!isRole(role)) return error("Unknown role.", 400, "invalid_role");
  if (target.origin === "config") {
    return error(
      "This address is listed as an admin in the Vestry config, so its role can only be changed there.",
      400,
      "config_admin",
    );
  }
  return lastAdminRefusal(admin, target);
}

/** Refuses to take away the last admin. */
async function lastAdminRefusal(
  admin: UserAdmin,
  target: PublicUser,
): Promise<Response | null> {
  if (target.role === "admin" && (await admin.adminCount()) <= 1) {
    return error(
      `${target.name} is the only admin. Make someone else an admin first.`,
      400,
      "last_admin",
    );
  }
  return null;
}

async function removeUser(admin: UserAdmin, id: string): Promise<Response> {
  if (id === admin.user.id)
    return error("You can't remove yourself.", 400, "self");
  const target = await admin.getUser(id);
  if (!target) return json({ ok: true });
  if (target.origin === "config") {
    return error(
      "This address is listed as an admin in the Vestry config. Remove it there first.",
      400,
      "config_admin",
    );
  }
  const refusal = await lastAdminRefusal(admin, target);
  if (refusal) return refusal;
  await admin.vestryAuth.auth.api.removeUser({
    body: { userId: id },
    headers: admin.headers,
  });
  return json({ ok: true });
}

async function resendInvite(admin: UserAdmin, id: string): Promise<Response> {
  const target = await admin.getUser(id);
  if (!target) return error("User not found.", 404, "not_found");
  await admin.vestryAuth.sendInvite(admin.user, target);
  return json({ user: target });
}

// ---------------------------------------------------------------- content

async function contentRoute(
  request: Request,
  route: Route,
  source: ContentSource,
  service: ContentService,
): Promise<Response> {
  const { url, segments, method } = route;
  const [section, key] = segments;
  if (section === "status" && method === "GET") {
    return json({ head: await source.head(), source: source.info() });
  }
  if (section === "collections" && key)
    return collectionRoute(request, route, key, source, service);
  if (section === "singletons" && key)
    return singletonRoute(request, route, key, service);
  if (section === "assets" && key)
    return assetsRoute(request, route, key, service);
  if (section === "file" && method === "GET") {
    const path = url.searchParams.get("path");
    if (!path) return error("Missing path", 400);
    return serveFile(service, path, request);
  }
  return notFound();
}

async function collectionRoute(
  request: Request,
  route: Route,
  key: string,
  source: ContentSource,
  service: ContentService,
): Promise<Response> {
  const { url, segments, method } = route;
  if (segments.length === 2 && method === "GET") {
    return json({
      entries: await service.listEntries(key),
      head: await source.head(),
    });
  }
  // Slugs can contain "/", so the entry is named in the query string.
  if (segments[2] === "references" && method === "GET") {
    const slug = url.searchParams.get("slug") ?? "";
    return json({ references: await service.referencesTo(key, slug) });
  }
  if (segments[2] === "entries")
    return entryRoute(request, route, key, service);
  return notFound();
}

async function entryRoute(
  request: Request,
  { segments, method }: Route,
  key: string,
  service: ContentService,
): Promise<Response> {
  const slug = segments.slice(3).join("/");
  if (!slug && method === "POST") {
    const input = await readJson<SaveEntryInput>(request);
    return json(await service.saveEntry(key, null, input), { status: 201 });
  }
  if (!slug) return notFound();
  if (method === "GET") {
    const entry = await service.getEntry(key, slug);
    return entry ? json(entry) : error("Entry not found", 404, "not_found");
  }
  if (method === "PUT") {
    const input = await readJson<SaveEntryInput>(request);
    return json(await service.saveEntry(key, slug, input));
  }
  if (method === "DELETE") return json(await service.deleteEntry(key, slug));
  return notFound();
}

async function singletonRoute(
  request: Request,
  { method }: Route,
  key: string,
  service: ContentService,
): Promise<Response> {
  if (method === "GET") return json(await service.getSingleton(key));
  if (method === "PUT") {
    const input = await readJson<SaveEntryInput>(request);
    return json(await service.saveSingleton(key, input));
  }
  return notFound();
}

async function assetsRoute(
  request: Request,
  { url, method }: Route,
  container: string,
  service: ContentService,
): Promise<Response> {
  const dir = url.searchParams.get("dir") ?? "";
  if (method === "GET") return json(await service.listAssets(container, dir));
  if (method === "POST") {
    const body = await readJson<{
      dir?: string;
      files: { name: string; base64: string }[];
    }>(request);
    return json(
      await service.uploadAssets(container, body.dir ?? dir, body.files ?? []),
      { status: 201 },
    );
  }
  if (method === "DELETE") {
    const body = await readJson<{ path: string }>(request);
    return json(await service.deleteAsset(container, body.path));
  }
  return notFound();
}

/** A Cloudflare D1 binding, by its shape (the type lives in workers-types). */
function isD1Like(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { prepare?: unknown }).prepare === "function" &&
    typeof (value as { batch?: unknown }).batch === "function" &&
    typeof (value as { exec?: unknown }).exec === "function"
  );
}

/** What signed-in users receive: everything the panel needs, minus mail settings. */
function clientConfig(config: VestryConfig): VestryConfig {
  const { mail: _mail, ...rest } = config;
  return rest;
}

/** What the sign-in page receives: branding only, no schema, no admin list. */
function publicConfig(config: VestryConfig): VestryConfig {
  return {
    name: config.name,
    logo: config.logo,
    siteUrl: config.siteUrl,
    repo: config.repo,
  };
}

async function serveFile(
  service: ContentService,
  path: string,
  request: Request,
): Promise<Response> {
  const file = await service.readFile(path);
  if (!file) return error("File not found", 404, "not_found");
  const etag = `"${file.sha}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const ext = extname(normalizePath(path));
  return new Response(file.bytes as BodyInit, {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=0, must-revalidate",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}

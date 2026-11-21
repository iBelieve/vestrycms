/**
 * Live preview: the unsaved entry the preview window sends to the site's
 * preview route, and the short-lived token that lets it in.
 *
 * The route renders with the site's own components, so it runs on every
 * keystroke's pause. It checks a signed token (one HMAC) instead of the
 * sign-in session, which would load Better Auth and query the database on
 * each request.
 */

/** A piece of a previewed body: HTML, or one of the site's components. */
export type PreviewPart = string | PreviewComponent;

export interface PreviewComponent {
  /** The component's name in `config.components`. */
  component: string;
  props: Record<string, unknown>;
  /** What goes in its default slot; null for a self-closing component. */
  children: PreviewPart[] | null;
}

/**
 * The unsaved entry, which the site's preview component draws: `data` as
 * the file would hold it (images and files as their fields store them).
 */
export interface PreviewEntry {
  collection: string;
  slug: string;
  /** The page's path on the site (from `previewUrl`), or null without one. */
  path: string | null;
  data: Record<string, unknown>;
}

export interface PreviewRequest {
  entry: PreviewEntry;
  body: PreviewPart[];
}

/** How long a preview token lasts; the window asks for another when it runs out. */
export const PREVIEW_TOKEN_SECONDS = 60 * 60;
/** The largest preview request accepted, in bytes. */
export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_DEPTH = 64;
const PURPOSE = "vestry-preview";

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const message = (expires: number) =>
  new TextEncoder().encode(`${PURPOSE}.${expires}`);

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  let binary: string;
  try {
    binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    // A length no base64 has (one past a multiple of four).
    return null;
  }
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** A preview token valid for `PREVIEW_TOKEN_SECONDS`, and when it expires (ms). */
export async function signPreviewToken(
  secret: string,
  now = Date.now(),
): Promise<{ token: string; expires: number }> {
  const expires = Math.floor(now / 1000) + PREVIEW_TOKEN_SECONDS;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    message(expires),
  );
  return {
    token: `${expires}.${base64Url(new Uint8Array(signature))}`,
    expires: expires * 1000,
  };
}

/** Whether `token` was signed with `secret` and has not expired. */
export async function verifyPreviewToken(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires * 1000 <= now) return false;
  const signature = fromBase64Url(match[2]);
  if (!signature) return false;
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature as BufferSource,
    message(expires),
  );
}

const refuse = (
  status: number,
  text: string,
  headers: Record<string, string> = {},
) =>
  new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });

/**
 * The preview a request asks for, or the response refusing it. `secret` is
 * null where the control panel has no sign-in (local `astro dev`).
 */
export async function readPreview(
  request: Request,
  { secret, collections }: { secret: string | null; collections: string[] },
): Promise<PreviewRequest | Response> {
  if (request.method !== "POST")
    return refuse(405, "Method not allowed", { Allow: "POST" });
  if (secret !== null) {
    const token = /^Bearer (.+)$/.exec(
      request.headers.get("authorization") ?? "",
    )?.[1];
    if (!token || !(await verifyPreviewToken(token, secret)))
      return refuse(401, "Sign in to preview");
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_PREVIEW_BYTES) return refuse(413, "Preview too large");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_PREVIEW_BYTES)
    return refuse(413, "Preview too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return refuse(400, "The preview is not JSON");
  }
  const problem = previewProblem(parsed, collections);
  return problem ? refuse(400, problem) : (parsed as PreviewRequest);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** What is wrong with a preview request's shape, or null. */
export function previewProblem(
  value: unknown,
  collections: string[],
): string | null {
  if (!isObject(value) || !isObject(value.entry))
    return "The preview needs an entry";
  const { entry, body } = value;
  if (
    typeof entry.collection !== "string" ||
    !collections.includes(entry.collection)
  )
    return `No preview for collection ${JSON.stringify(entry.collection)}`;
  if (typeof entry.slug !== "string") return "The entry needs a slug";
  if (entry.path !== null && typeof entry.path !== "string")
    return "The entry's path must be a string or null";
  if (!isObject(entry.data)) return "The entry's data must be an object";
  return partsProblem(body, 0);
}

function partsProblem(parts: unknown, depth: number): string | null {
  if (!Array.isArray(parts)) return "The body must be a list of parts";
  if (depth > MAX_DEPTH) return "The body is nested too deeply";
  for (const part of parts) {
    const problem = partProblem(part, depth);
    if (problem) return problem;
  }
  return null;
}

function partProblem(part: unknown, depth: number): string | null {
  if (typeof part === "string") return null;
  if (!isObject(part) || typeof part.component !== "string")
    return "Each part of the body is HTML or a component";
  if (!isObject(part.props)) return "A component's props must be an object";
  return part.children === null ? null : partsProblem(part.children, depth + 1);
}

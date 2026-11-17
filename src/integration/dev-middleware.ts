import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable, pipeline } from "node:stream";
import type { ReadableStream } from "node:stream/web";

/**
 * Bridge a Node HTTP request to the Fetch API handler and write the Response
 * back. Used by the Vite dev server middleware.
 */
export function nodeToFetchHandler(
  handle: (request: Request) => Promise<Response>,
) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => {
    try {
      writeResponse(res, await handle(await toRequest(req)));
    } catch (e) {
      next(e);
    }
  };
}

/** A Node request as a Fetch API request. */
async function toRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? "/", originOf(req));
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    // HTTP/2's pseudo-headers (`:method`, `:authority`) are not header names.
    if (k.startsWith(":")) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (typeof v === "string") headers.set(k, v);
  }
  const method = req.method ?? "GET";
  const body =
    method === "GET" || method === "HEAD" ? undefined : await readBody(req);
  return new Request(url, { method, headers, body });
}

/**
 * The origin the browser sees, which the API compares with the `Origin` of
 * writes: the scheme a proxy reports or the connection's own (TLS when Vite
 * serves HTTPS), and the host (HTTP/2's `:authority`).
 */
function originOf(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-proto"];
  const encrypted = (req.socket as { encrypted?: boolean } | undefined)
    ?.encrypted;
  const proto =
    typeof forwarded === "string"
      ? forwarded.split(",")[0]!.trim()
      : encrypted
        ? "https"
        : "http";
  const authority = req.headers[":authority"];
  const host =
    req.headers.host ??
    (typeof authority === "string" ? authority : "localhost");
  return `${proto}://${host}`;
}

async function readBody(req: IncomingMessage): Promise<BodyInit> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}

/** Write a Fetch API response to a Node response. */
function writeResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  if (response.body) {
    // pipeline, unlike pipe, ends the response if the body fails, rather
    // than leaving the error unhandled.
    pipeline(Readable.fromWeb(response.body as ReadableStream), res, () => {});
  } else {
    res.end();
  }
}

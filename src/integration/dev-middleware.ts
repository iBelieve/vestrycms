import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

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
      const host = req.headers.host ?? "localhost";
      const proto =
        (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
      const url = new URL(req.url ?? "/", `${proto}://${host}`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
        else if (typeof v === "string") headers.set(k, v);
      }
      const method = req.method ?? "GET";
      let body: BodyInit | undefined;
      if (method !== "GET" && method !== "HEAD") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        body = new Uint8Array(Buffer.concat(chunks));
      }
      const response = await handle(
        new Request(url, { method, headers, body }),
      );
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") return;
        res.setHeader(key, value);
      });
      const cookies = response.headers.getSetCookie?.() ?? [];
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
      if (response.body) {
        Readable.fromWeb(
          response.body as import("node:stream/web").ReadableStream,
        ).pipe(res);
      } else {
        res.end();
      }
    } catch (e) {
      next(e);
    }
  };
}

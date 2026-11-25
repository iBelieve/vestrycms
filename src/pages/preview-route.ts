/// <reference path="../env.d.ts" />
import { auth, components, previews } from "virtual:vestry/preview";
import { readPreview, type PreviewRequest } from "../core/preview.js";
import { readEnv } from "./env.js";

/** A preview ready to render: the collection's preview component and what it draws. */
export interface OpenedPreview extends PreviewRequest {
  Preview: unknown;
  components: Record<string, unknown>;
}

/**
 * The preview a request to the preview route asks for, or the response
 * refusing it (see `readPreview`).
 */
export async function openPreview(
  request: Request,
): Promise<OpenedPreview | Response> {
  // An empty VESTRY_SECRET is missing, as the API has it.
  const secret =
    auth.mode === "none"
      ? null
      : auth.mode === "secret"
        ? auth.secret
        : readEnv("VESTRY_SECRET") || undefined;
  if (secret === undefined)
    return new Response("Missing environment variable: VESTRY_SECRET", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  const read = await readPreview(request, {
    secret,
    collections: Object.keys(previews),
  });
  if (read instanceof Response) return read;
  return { ...read, Preview: previews[read.entry.collection], components };
}

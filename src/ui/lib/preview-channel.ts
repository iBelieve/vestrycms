/**
 * How the editor and the preview window talk: a BroadcastChannel per
 * control panel, so the window follows whichever editor is in use, in any
 * tab, and an editor opened later finds a window that is already open.
 *
 * - The window says `hello` when it opens (and in answer to `who`), and
 *   `bye` when it closes.
 * - An editor asks `who` when it opens, and sends its `entry` whenever it
 *   changes while a window is open, and in answer to `hello`.
 */

/** The entry as an editor holds it, which the window renders. */
export interface PreviewSnapshot {
  collection: string;
  slug: string;
  /** The file the entry is saved to, which relative images resolve against. */
  filePath: string;
  /** The page's path on the site, or null without a `previewUrl`. */
  path: string | null;
  title: string;
  data: Record<string, unknown>;
  body: string;
  /** Unsaved uploads: repository path → a URL the browser can show it from. */
  uploads: Record<string, string>;
}

export type PreviewMessage =
  | { type: "hello" }
  | { type: "bye" }
  | { type: "who" }
  | { type: "entry"; snapshot: PreviewSnapshot };

/** The window's name, so Preview brings back the window that is open. */
export const PREVIEW_WINDOW = "vestry-preview";

export function previewChannel(basePath: string): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(`vestry-preview:${basePath}`);
}

export function isPreviewMessage(value: unknown): value is PreviewMessage {
  if (typeof value !== "object" || value === null) return false;
  const { type } = value as { type?: unknown };
  if (type === "entry")
    return (
      typeof (value as { snapshot?: unknown }).snapshot === "object" &&
      (value as { snapshot?: unknown }).snapshot !== null
    );
  return type === "hello" || type === "bye" || type === "who";
}

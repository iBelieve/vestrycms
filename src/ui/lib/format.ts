/// <reference path="../../env.d.ts" />
import type { EntryFormat } from "../../config/types.js";
import { ignoreMatcher } from "../../core/ignore.js";
import { keepDocument } from "../../mdx/index.js";

/**
 * Formats a file with the project's Prettier (via `virtual:vestry/formatter`).
 * Prettier is loaded lazily on first save so it stays out of the initial bundle.
 * Files matched by the project's `.prettierignore` are returned as written.
 */
async function formatSource(text: string, filepath: string): Promise<string> {
  const mod = await import("virtual:vestry/formatter");
  if (!mod.available) return text;
  // The ignore file cannot change while the page is open.
  ignored ??= ignoreMatcher(mod.ignore);
  return ignored(filepath) ? text : mod.formatFile(text, filepath);
}

let ignored: ((path: string) => boolean) | undefined;

/** Formats an entry's file, keeping the body as written where Prettier would change what it says. */
export async function formatEntry(
  text: string,
  filepath: string,
  format: EntryFormat,
): Promise<string> {
  const formatted = await formatSource(text, filepath);
  return format === "md" || format === "mdx"
    ? keepDocument(text, formatted, format)
    : formatted;
}

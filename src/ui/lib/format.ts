/// <reference path="../../env.d.ts" />

/**
 * Formats a file with the project's Prettier (via `virtual:vestry/formatter`).
 * Prettier is loaded lazily on first save so it stays out of the initial bundle.
 */
export async function formatSource(
  text: string,
  filepath: string,
): Promise<string> {
  const mod = await import("virtual:vestry/formatter");
  if (!mod.available) return text;
  return mod.formatFile(text, filepath);
}

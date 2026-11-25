import { statSync } from "node:fs";
import path from "node:path";
import { isLogoUrl, logoVariants } from "../config/logo.js";
import type { VestryConfig } from "../config/types.js";
import { isSafeRepoPath, normalizePath } from "../core/paths.js";

/**
 * Generates the `virtual:vestry/logo` module: the URLs of the configured
 * logos (`onDark` and `onLight`) as build assets, so the control panel shows
 * them without reading the repository. The sign-in page needs a logo before
 * anyone is signed in, and fetching it through the API needs the GitHub
 * credentials, so a site still being set up would show a broken image. Each
 * export is `null` when that logo is missing, an absolute URL, or not a file
 * in the project; the panel then loads it through the API.
 */
export function logoModule(root: string, logo: VestryConfig["logo"]): string {
  const variants = logoVariants(logo);
  return (["onDark", "onLight"] as const)
    .map((name) => {
      const file = projectFile(root, variants[name]);
      return file
        ? `export { default as ${name} } from ${JSON.stringify(`${file}?url`)};\n`
        : `export const ${name} = null;\n`;
    })
    .join("");
}

/** A logo's file in the project, or null when there is none to bundle. */
function projectFile(root: string, logo: string | undefined): string | null {
  if (!logo || isLogoUrl(logo)) return null;
  // The same repository path the API would serve: nothing outside the
  // project, and a file (a folder would fail the site's build).
  const repoPath = normalizePath(logo);
  if (!isSafeRepoPath(repoPath)) return null;
  const file = path.join(root, repoPath);
  return statSync(file, { throwIfNoEntry: false })?.isFile() ? file : null;
}

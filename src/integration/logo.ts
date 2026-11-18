import { statSync } from "node:fs";
import path from "node:path";
import { isSafeRepoPath, normalizePath } from "../core/paths.js";

/**
 * Generates the `virtual:vestry/logo` module: the URL of the configured logo
 * as a build asset, so the control panel shows it without reading the
 * repository. The sign-in page needs the logo before anyone is signed in,
 * and fetching it through the API needs the GitHub credentials, so a site
 * still being set up would show a broken image. The module exports `null`
 * when there is no logo, when it is an absolute URL, or when it is not a
 * file in the project; the panel then loads it through the API.
 */
export function logoModule(root: string, logo: string | undefined): string {
  const none = "export default null;\n";
  if (!logo || /^https?:\/\//.test(logo)) return none;
  // The same repository path the API would serve: nothing outside the
  // project, and a file (a folder would fail the site's build).
  const repoPath = normalizePath(logo);
  if (!isSafeRepoPath(repoPath)) return none;
  const file = path.join(root, repoPath);
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return none;
  return `import url from ${JSON.stringify(`${file}?url`)};\nexport default url;\n`;
}

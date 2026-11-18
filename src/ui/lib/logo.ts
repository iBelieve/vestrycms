/// <reference path="../../env.d.ts" />
import bundledLogo from "virtual:vestry/logo";
import type { ApiClient } from "../api.js";

/**
 * Where the panel loads the configured logo from: an absolute URL as given,
 * else the copy bundled at build time, else the repository file through
 * the API.
 */
export function logoSrc(
  logo: string | undefined,
  api: Pick<ApiClient, "fileUrl">,
): string | null {
  if (!logo) return null;
  if (/^https?:\/\//.test(logo)) return logo;
  return bundledLogo ?? api.fileUrl(logo);
}

/// <reference path="../../env.d.ts" />
import * as bundled from "virtual:vestry/logo";
import { isLogoUrl, logoVariants } from "../../config/logo.js";
import type { VestryConfig } from "../../config/types.js";
import type { ApiClient } from "../api.js";

/** Where the panel loads each of the configured logos from. */
export interface LogoUrls {
  /** For dark surfaces: the top bar, the sign-in page in dark mode. */
  onDark: string | null;
  /** For light surfaces: the sign-in page. */
  onLight: string | null;
}

/**
 * Where the panel loads the configured logos from: an absolute URL as given,
 * else the copy bundled at build time, else the repository file through
 * the API. A logo that isn't configured is null.
 */
export function logoUrls(
  logo: VestryConfig["logo"],
  api: Pick<ApiClient, "fileUrl">,
): LogoUrls {
  const variants = logoVariants(logo);
  const url = (name: keyof LogoUrls): string | null => {
    const path = variants[name];
    if (!path) return null;
    if (isLogoUrl(path)) return path;
    return bundled[name] ?? api.fileUrl(path);
  };
  return { onDark: url("onDark"), onLight: url("onLight") };
}

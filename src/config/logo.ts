import type { LogoConfig, VestryConfig } from "./types.js";

/** The configured logo for each surface; a plain path is the dark one. */
export function logoVariants(logo: VestryConfig["logo"]): LogoConfig {
  if (!logo) return {};
  if (typeof logo === "string") return { onDark: logo };
  return { onDark: logo.onDark, onLight: logo.onLight };
}

/** Whether a logo is an absolute URL rather than a repository path. */
export function isLogoUrl(logo: string): boolean {
  return /^https?:\/\//.test(logo);
}

/** The logos that are repository files, which the API serves to anyone. */
export function logoFiles(logo: VestryConfig["logo"]): string[] {
  const { onDark, onLight } = logoVariants(logo);
  return [onDark, onLight].filter(
    (path): path is string => Boolean(path) && !isLogoUrl(path!),
  );
}

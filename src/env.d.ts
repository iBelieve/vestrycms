declare module "virtual:vestry/config" {
  const config: import("./config/types.js").VestryConfig;
  export default config;
}

declare module "virtual:vestry/index" {
  const index: import("./core/index-types.js").BuildIndex;
  export default index;
}

declare module "virtual:vestry/runtime" {
  export const basePath: string;
  export const name: string;
}

declare module "virtual:vestry/formatter" {
  export const available: boolean;
  /** The project's `.prettierignore`, or an empty string. */
  export const ignore: string;
  export function formatFile(text: string, filepath: string): Promise<string>;
}

declare module "virtual:vestry/logo" {
  /** The logo for dark surfaces as a build asset, or null to load it through the API. */
  export const onDark: string | null;
  /** The logo for light surfaces as a build asset, or null to load it through the API. */
  export const onLight: string | null;
}

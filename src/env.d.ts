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
  export function formatFile(text: string, filepath: string): Promise<string>;
}

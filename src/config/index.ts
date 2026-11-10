import type {
  AssetContainerConfig,
  CollectionConfig,
  ComponentConfig,
  SingletonConfig,
  VestryConfig,
} from "./types.js";

export * from "./types.js";
export { fields } from "./fields.js";

/** Identity helper that gives you editor completions for the config shape. */
export function defineConfig(config: VestryConfig): VestryConfig {
  return config;
}

export function collection(config: CollectionConfig): CollectionConfig {
  return config;
}

export function singleton(config: SingletonConfig): SingletonConfig {
  return config;
}

export function component(config: ComponentConfig = {}): ComponentConfig {
  return config;
}

export function assetContainer(
  config: AssetContainerConfig,
): AssetContainerConfig {
  return config;
}

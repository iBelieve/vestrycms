import type { VestryConfig } from "../config/types.js";

/** How the preview route checks requests: no sign-in, a fixed secret, or `VESTRY_SECRET`. */
export type PreviewAuth =
  { mode: "none" } | { mode: "secret"; secret: string } | { mode: "env" };

/** Whether any collection has a live preview. */
export const hasPreview = (config: VestryConfig): boolean =>
  Object.values(config.collections ?? {}).some((col) => Boolean(col.preview));

/**
 * Generates the `virtual:vestry/preview` module for the preview route: the
 * site's components by their config name, each collection's preview
 * component, and how requests are checked. Specifiers are resolved here, as
 * the site's own files would resolve them (`@/…` aliases included), and one
 * that doesn't resolve is left out with a warning rather than failing the
 * site's build: that component then shows as a placeholder.
 */
export async function previewModule(
  config: VestryConfig,
  {
    resolve,
    warn,
    auth,
  }: {
    resolve: (specifier: string) => Promise<string | null>;
    warn: (message: string) => void;
    auth: PreviewAuth;
  },
): Promise<string> {
  const imports = new Imports(resolve, warn);
  const used = hasPreview(config);
  const components = used ? await componentEntries(config, imports) : [];
  const previews = used ? await previewEntries(config, imports) : [];
  return `${[
    ...imports.lines,
    `export const components = {${components.join(", ")}};`,
    `export const previews = {${previews.join(", ")}};`,
    `export const auth = ${JSON.stringify(auth)};`,
  ].join("\n")}\n`;
}

/** `name: local` for each component the site's files can import. */
async function componentEntries(
  config: VestryConfig,
  imports: Imports,
): Promise<string[]> {
  const entries: string[] = [];
  for (const [name, component] of Object.entries(config.components ?? {})) {
    if (!component.import || component.preview === false) continue;
    const named = component.namedImport ? name : null;
    const local = await imports.add(
      component.import,
      named,
      `component ${name}`,
    );
    if (local) entries.push(`${JSON.stringify(name)}: ${local}`);
  }
  return entries;
}

/** `collection: local` for each collection's preview component. */
async function previewEntries(
  config: VestryConfig,
  imports: Imports,
): Promise<string[]> {
  const entries: string[] = [];
  for (const [key, col] of Object.entries(config.collections ?? {})) {
    if (!col.preview) continue;
    const local = await imports.add(col.preview, null, `${key}'s preview`);
    if (local) entries.push(`${JSON.stringify(key)}: ${local}`);
  }
  return entries;
}

/** The module's import statements, each under a name of its own. */
class Imports {
  readonly lines: string[] = [];
  readonly #resolve: (specifier: string) => Promise<string | null>;
  readonly #warn: (message: string) => void;

  constructor(
    resolve: (specifier: string) => Promise<string | null>,
    warn: (message: string) => void,
  ) {
    this.#resolve = resolve;
    this.#warn = warn;
  }

  /** Imports `specifier` (its export `named`, or its default) and returns the local name; null if it doesn't resolve. */
  async add(
    specifier: string,
    named: string | null,
    what: string,
  ): Promise<string | null> {
    const id = await this.#resolve(specifier);
    if (!id) {
      this.#warn(`Live preview: can't resolve ${what} (${specifier})`);
      return null;
    }
    const local = `C${this.lines.length}`;
    this.lines.push(
      named
        ? `import { ${named} as ${local} } from ${JSON.stringify(id)};`
        : `import ${local} from ${JSON.stringify(id)};`,
    );
    return local;
  }
}

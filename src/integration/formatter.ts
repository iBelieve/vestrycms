import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Generates the `virtual:vestry/formatter` module. When the project has
 * Prettier installed, the control panel formats files with it before saving
 * (using the project's own Prettier config), so commits made through Vestry
 * match what `prettier --check` expects. Otherwise the module is a no-op.
 *
 * `enabled: false` (the `format: false` config option) always gives the
 * no-op module, for projects whose content Prettier does not format safely.
 */
export async function formatterModule(
  root: string,
  enabled = true,
): Promise<string> {
  const none = `export const available = false;\nexport async function formatFile(text) { return text; }\n`;
  if (!enabled) return none;
  const require = createRequire(path.join(root, "package.json"));
  let standalone: string;
  let plugins: Record<string, string>;
  try {
    // Resolve the ESM builds explicitly: `require.resolve` would pick the
    // CommonJS entry, which doesn't load as a module in the browser.
    const pkgDir = path.dirname(require.resolve("prettier/package.json"));
    standalone = path.join(pkgDir, "standalone.mjs");
    plugins = {
      markdown: path.join(pkgDir, "plugins/markdown.mjs"),
      yaml: path.join(pkgDir, "plugins/yaml.mjs"),
      babel: path.join(pkgDir, "plugins/babel.mjs"),
      estree: path.join(pkgDir, "plugins/estree.mjs"),
    };
    if (![standalone, ...Object.values(plugins)].every((p) => existsSync(p)))
      throw new Error("prettier layout");
  } catch {
    return none;
  }

  let options: Record<string, unknown> = {};
  try {
    const prettier = await import(
      /* @vite-ignore */ pathToFileURL(require.resolve("prettier")).href
    );
    const resolved = await prettier.resolveConfig(
      path.join(root, "README.md"),
      { editorconfig: true },
    );
    if (resolved) {
      options = { ...resolved };
      // Plugins from the config are resolved in Node; the browser gets the fixed set above.
      delete options.plugins;
    }
  } catch {
    /* fall back to defaults */
  }

  return [
    `import * as prettier from ${JSON.stringify(standalone)};`,
    ...Object.entries(plugins).map(
      ([name, p]) => `import * as ${name} from ${JSON.stringify(p)};`,
    ),
    `export const available = true;`,
    `const options = ${JSON.stringify(options)};`,
    `export async function formatFile(text, filepath) {`,
    `  return prettier.format(text, { ...options, filepath, plugins: [markdown, yaml, babel, estree] });`,
    `}`,
    "",
  ].join("\n");
}

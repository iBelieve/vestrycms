/**
 * Parses each given Markdown/MDX file into the editor document, serialises it
 * back, formats both sides with the project's Prettier config, and reports
 * whether the round trip is lossless. Usage:
 *
 *   node --import tsx/esm test/roundtrip.ts path/to/file.mdx [...]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { splitFrontmatter } from "../src/core/entries.ts";
import { parseMdx, serializeMdx } from "../src/mdx/index.ts";

const require = createRequire(import.meta.url);
let prettier: typeof import("prettier") | null = null;
try {
  prettier = require("prettier");
} catch {
  /* optional */
}

const files = process.argv.slice(2);
let failed = 0;
for (const f of files) {
  const abs = path.resolve(f);
  const text = readFileSync(abs, "utf8");
  const { body } = splitFrontmatter(text);
  const parsed = parseMdx(body);
  const components: Record<string, { import?: string; namedImport?: boolean }> =
    {};
  for (const [name, spec] of Object.entries(parsed.imports)) {
    components[name] = { import: spec.from, namedImport: spec.named };
  }
  let out = serializeMdx(parsed.doc, {
    components,
    existingImports: parsed.imports,
  });
  let input = body.replace(/^\s*\n/, "");
  if (prettier) {
    const options = (await prettier.resolveConfig(abs)) ?? {};
    out = await prettier.format(out, { ...options, filepath: abs });
    input = await prettier.format(input, { ...options, filepath: abs });
  }
  const same = out.trim() === input.trim();
  if (!same) failed++;
  console.log(
    `${same ? "SAME" : "DIFF"} ${f}${prettier ? "" : " (prettier not installed; raw comparison)"}`,
  );
  if (!same && process.env.SHOW) {
    const dir = process.env.SHOW_DIR ?? process.cwd();
    writeFileSync(path.join(dir, "roundtrip-in.mdx"), input);
    writeFileSync(path.join(dir, "roundtrip-out.mdx"), out);
    console.log(`  wrote roundtrip-in.mdx / roundtrip-out.mdx to ${dir}`);
  }
}
process.exit(failed ? 1 : 0);

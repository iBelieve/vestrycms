/** The round-trip fixtures in test/fixtures/mdx, shared by the test files. */
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("./fixtures/mdx/", import.meta.url);

export const fixtures = readdirSync(dir)
  .filter((f) => /\.mdx?$/.test(f))
  .map((name) => ({
    name,
    source: readFileSync(new URL(name, dir), "utf8"),
    format: name.endsWith(".mdx") ? ("mdx" as const) : ("md" as const),
  }));

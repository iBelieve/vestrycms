/**
 * Fixture documents pass through the editor's ProseMirror schema unchanged:
 * a node type or attribute the schema lacks would be dropped when an editor
 * loads and saves the page.
 */
import { readdirSync, readFileSync } from "node:fs";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { parseMdx, serializeMdx } from "../src/mdx/index.js";
import { editorExtensions } from "../src/ui/components/editor/schema.js";

const dir = new URL("./fixtures/mdx/", import.meta.url);
const fixtures = readdirSync(dir)
  .filter((f) => /\.mdx?$/.test(f))
  .map((name) => ({
    name,
    source: readFileSync(new URL(name, dir), "utf8"),
    format: name.endsWith(".mdx") ? ("mdx" as const) : ("md" as const),
  }));

const schema = getSchema(editorExtensions());

describe("editor schema", () => {
  it.each(fixtures)("$name survives the editor", ({ source, format }) => {
    const parsed = parseMdx(source, { format });
    const json = Node.fromJSON(schema, parsed.doc).toJSON();
    expect(
      serializeMdx(json, { format, existingImports: parsed.imports }),
    ).toBe(source);
  });
});

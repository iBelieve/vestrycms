/**
 * Fixture documents pass through the editor's ProseMirror schema unchanged:
 * a node type or attribute the schema lacks would be dropped when an editor
 * loads and saves the page.
 */
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { parseMdx, serializeMdx } from "../src/mdx/index.js";
import { editorExtensions } from "../src/ui/components/editor/schema.js";
import { fixtures } from "./mdx-fixtures.js";

const schema = getSchema(editorExtensions());

describe("editor schema", () => {
  it.each(fixtures)("$name survives the editor", ({ source, format }) => {
    const parsed = parseMdx(source, { format });
    const node = Node.fromJSON(schema, parsed.doc);
    node.check(); // content the schema forbids would be rejected or rewritten
    const json = node.toJSON();
    expect(
      serializeMdx(json, { format, existingImports: parsed.imports }),
    ).toBe(source);
  });
});

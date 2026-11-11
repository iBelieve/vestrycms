/**
 * Round trips Markdown/MDX through the editor document (ProseMirror JSON) and
 * back. Fixtures in test/fixtures/mdx are written in the serializer's canonical
 * style, so a lossless round trip reproduces them byte for byte.
 */
import { describe, expect, it } from "vitest";
import { parseMdx, serializeMdx } from "../src/mdx/index.js";
import { fixtures } from "./mdx-fixtures.js";

function roundTrip(source: string, format: "md" | "mdx" = "mdx") {
  const parsed = parseMdx(source, { format });
  return serializeMdx(parsed.doc, { format, existingImports: parsed.imports });
}

describe("fixtures", () => {
  it.each(fixtures)("$name round-trips unchanged", ({ source, format }) => {
    expect(roundTrip(source, format)).toBe(source);
  });

  it.each(fixtures)(
    "$name parses to the expected document",
    ({ source, format }) => {
      expect(parseMdx(source, { format })).toMatchSnapshot();
    },
  );
});

describe("normalization to the canonical style", () => {
  it.each([
    ["*emphasis*\n", "_emphasis_\n"],
    ["__strong__\n", "**strong**\n"],
    ["* one\n* two\n", "- one\n- two\n"],
    ["***\n", "---\n"],
    ["Setext\n======\n", "# Setext\n"],
    [
      "[docs][d]\n\n[d]: https://example.org\n",
      "[docs](https://example.org)\n",
    ],
    ["<Box>\n  Child text\n</Box>\n", "<Box>\n\nChild text\n\n</Box>\n"],
  ])("%j → %j", (input, output) => {
    expect(roundTrip(input)).toBe(output);
  });

  it("fences indented code in Markdown (MDX has no indented code)", () => {
    expect(roundTrip("    indented code\n", "md")).toBe(
      "```\nindented code\n```\n",
    );
  });

  it("gives an empty document one empty paragraph", () => {
    expect(parseMdx("").doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(roundTrip("")).toBe("");
  });
});

describe("imports", () => {
  it("adds an import for a registered component the document uses", () => {
    const { doc } = parseMdx("<Callout />\n");
    expect(
      serializeMdx(doc, {
        components: { Callout: { import: "../components/Callout.astro" } },
      }),
    ).toBe(
      'import Callout from "../components/Callout.astro";\n\n<Callout />\n',
    );
  });

  it("keeps comments in an import block", () => {
    const source =
      'import A from "./a.ts";\n// Keep me.\nexport const x = 1;\n\n<A />\n';
    expect(roundTrip(source)).toBe(
      'import A from "./a.ts";\n\n// Keep me.\nexport const x = 1;\n\n<A />\n',
    );
  });

  it("drops imports for components the document no longer uses", () => {
    const parsed = parseMdx('import Callout from "./Callout.astro";\n\nText\n');
    expect(serializeMdx(parsed.doc, { existingImports: parsed.imports })).toBe(
      "Text\n",
    );
  });
});

describe("lists", () => {
  it("loosens a list when an item's blocks need a blank line", () => {
    // Kind 7 HTML would otherwise join the paragraph before it.
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { spread: false },
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "One" }] },
                { type: "rawHtml", attrs: { value: "<span>" } },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Two" }] },
              ],
            },
          ],
        },
      ],
    };
    expect(serializeMdx(doc, { format: "md" })).toBe(
      "- One\n\n  <span>\n\n- Two\n",
    );
  });

  it("loosens a list when an item holds two paragraphs", () => {
    // The editor can put two paragraphs in an item of a tight list; written
    // tight they would merge into one.
    const paragraph = (text: string) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    });
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { spread: false },
          content: [
            {
              type: "listItem",
              content: [paragraph("One"), paragraph("More")],
            },
            { type: "listItem", content: [paragraph("Two")] },
          ],
        },
      ],
    };
    expect(serializeMdx(doc, { format: "md" })).toBe(
      "- One\n\n  More\n\n- Two\n",
    );
  });
});

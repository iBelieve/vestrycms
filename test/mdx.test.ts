/**
 * Round trips Markdown/MDX through the editor document (ProseMirror JSON) and
 * back. Fixtures in test/fixtures/mdx are written in the serializer's canonical
 * style, so a lossless round trip reproduces them byte for byte.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMdx, serializeMdx } from "../src/mdx/index.js";

const dir = new URL("./fixtures/mdx/", import.meta.url);
const fixtures = readdirSync(dir).filter((f) => /\.mdx?$/.test(f));

function roundTrip(source: string, format: "md" | "mdx" = "mdx") {
  const parsed = parseMdx(source, { format });
  return serializeMdx(parsed.doc, { format, existingImports: parsed.imports });
}

describe("fixtures", () => {
  it.each(fixtures)("%s round-trips unchanged", (name) => {
    const source = readFileSync(new URL(name, dir), "utf8");
    const format = name.endsWith(".mdx") ? "mdx" : "md";
    expect(roundTrip(source, format)).toBe(source);
  });

  it.each(fixtures)("%s parses to the expected document", (name) => {
    const source = readFileSync(new URL(name, dir), "utf8");
    const format = name.endsWith(".mdx") ? "mdx" : "md";
    expect(parseMdx(source, { format })).toMatchSnapshot();
  });
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

  it("drops imports for components the document no longer uses", () => {
    const parsed = parseMdx('import Callout from "./Callout.astro";\n\nText\n');
    expect(serializeMdx(parsed.doc, { existingImports: parsed.imports })).toBe(
      "Text\n",
    );
  });
});

// Known gaps: these fail today. Vitest reports them if they start passing,
// so move them into the fixtures once fixed.
describe("known gaps", () => {
  it.fails("keeps footnotes", () => {
    const source = "Text[^1].\n\n[^1]: The note.\n";
    expect(roundTrip(source, "md")).toBe(source);
  });

  it.fails("keeps loose lists loose", () => {
    const source = "- One\n\n  More.\n\n- Two\n";
    expect(roundTrip(source, "md")).toBe(source);
  });
});

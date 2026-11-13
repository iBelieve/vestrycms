/**
 * Formatting on save: Prettier's output replaces the file Vestry composed
 * only where it leaves the document as it was.
 */
import * as prettier from "prettier";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keepDocument } from "../src/mdx/index.js";
import { fixtures } from "./mdx-fixtures.js";

const format = (text: string, filepath = "entry.mdx") =>
  prettier.format(text, { filepath });

const frontmatter = "---\ntitle: 'Entry'\n---\n\n";
const formattedFrontmatter = '---\ntitle: "Entry"\n---\n\n';

/** A paragraph that is one element, longer than Prettier's print width. */
const styled =
  '<span class="lead">A whole paragraph in one styled span, which runs well past the eighty columns Prettier allows a line.</span>\n';

describe("keepDocument", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  afterEach(() => warn.mockClear());

  it("takes Prettier's output when the document is the same", async () => {
    const text = `${frontmatter}Some   text.\n\n* one\n* two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n\`\`\`js\nconst x=1\n\`\`\`\n\n<Callout   kind="note" />\n`;
    const formatted = await format(text);
    expect(formatted).toBe(
      `${formattedFrontmatter}Some text.\n\n- one\n- two\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\n<Callout kind="note" />\n`,
    );
    expect(keepDocument(text, formatted, "mdx")).toBe(formatted);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the body when Prettier would turn a paragraph into a block", async () => {
    const text = `${frontmatter}${styled}`;
    const formatted = await format(text);
    expect(formatted).toContain('<span class="lead">\n  A whole paragraph');
    expect(keepDocument(text, formatted, "mdx")).toBe(
      `${formattedFrontmatter}${styled}`,
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it("keeps the body when Prettier would lose a hard break", async () => {
    const text = "<u>Note:</u> one\\\ntwo\n";
    const formatted = await format(text);
    expect(formatted).toBe("<u>Note:</u> one\\ two\n");
    expect(keepDocument(text, formatted, "mdx")).toBe(text);
  });

  it("takes Prettier's output for a paragraph it only re-wraps", async () => {
    const text =
      "<u>Note:</u> a paragraph that begins with an element and then runs well past the eighty columns Prettier allows.\n";
    const formatted = await format(text);
    expect(formatted).not.toBe(text);
    expect(keepDocument(text, formatted, "mdx")).toBe(formatted);
  });

  it("takes Prettier's output for source the editor cannot parse", () => {
    expect(keepDocument("<u>unclosed\n", "<u>unclosed \n", "mdx")).toBe(
      "<u>unclosed \n",
    );
  });

  it.each(fixtures)(
    "$name is saved with the document it had",
    async ({ name, source, format: kind }) => {
      const saved = keepDocument(source, await format(source, name), kind);
      // Either Prettier's output or the fixture itself, never a third thing.
      expect([await format(source, name), source]).toContain(saved);
      expect(keepDocument(saved, saved, kind)).toBe(saved);
    },
  );

  // Prettier's MDX parser predates MDX 2: a paragraph that begins with a tag
  // is a JSX block to it. Should this start passing, keepDocument has less
  // to guard against.
  it.fails(
    "Prettier leaves a paragraph that begins with an element alone",
    async () => {
      expect(await format(styled)).toBe(styled);
    },
  );
});

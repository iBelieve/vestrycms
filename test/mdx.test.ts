/**
 * Round trips Markdown/MDX through the editor document (ProseMirror JSON) and
 * back. Fixtures in test/fixtures/mdx are written in the serializer's canonical
 * style, so a lossless round trip reproduces them byte for byte.
 */
import { describe, expect, it } from "vitest";
import { parseMdx, serializeMdx } from "../src/mdx/index.js";
import type { PMMark, PMNode } from "../src/mdx/types.js";
import { fixtures } from "./mdx-fixtures.js";

function roundTrip(source: string, format: "md" | "mdx" = "mdx") {
  const parsed = parseMdx(source, { format });
  return serializeMdx(parsed.doc, { format, existingImports: parsed.imports });
}

/** The inline content of a document's first block. */
function inline(source: string, format: "md" | "mdx" = "mdx") {
  return parseMdx(source, { format }).doc.content?.[0].content;
}

const text = (value: string, ...marks: (string | PMMark)[]): PMNode => ({
  type: "text",
  text: value,
  ...(marks.length
    ? { marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) }
    : {}),
});
const hardBreak = (...marks: string[]): PMNode => ({
  type: "hardBreak",
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const paragraph = (...content: PMNode[]): PMNode => ({
  type: "paragraph",
  content,
});
const doc = (...content: PMNode[]): PMNode => ({ type: "doc", content });
const textClass = (name: string): PMMark => ({
  type: "textClass",
  attrs: { class: name },
});

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
    // Marks on the same text nest in one order.
    ["<u>**both**</u>\n", "**<u>both</u>**\n"],
    [
      '<u><span class="a">both</span></u>\n',
      '<span class="a"><u>both</u></span>\n',
    ],
    ["**<sup>2</sup>**\n", "<sup>**2**</sup>\n"],
    // A break is Markdown where it can be and an element where it cannot.
    ["one<br />two\n", "one\\\ntwo\n"],
    ["one<br></br>two\n", "one\\\ntwo\n"],
    ["one\\\n<u>two</u>\n", "one<br /><u>two</u>\n"],
    ["**one<br />**\n", "**one**<br />\n"],
    ["one\\\ntwo\n---\n", "## one<br />two\n"],
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

describe("known gaps", () => {
  // mdast-util-gfm linkifies bare URLs in text after parsing, escaped or not,
  // so text that was written not to be a link is saved as one.
  it.fails("keeps an escaped URL as text", () => {
    expect(roundTrip("Visit www\\.example.com today.\n")).toBe(
      "Visit www\\.example.com today.\n",
    );
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

describe("inline marks", () => {
  it("reads plain elements as marks on their children", () => {
    expect(
      inline(
        'a <u>b</u> <small>c</small> <span class="lead big">d **e**</span>\n',
      ),
    ).toEqual([
      text("a "),
      text("b", "underline"),
      text(" "),
      text("c", "small"),
      text(" "),
      text("d ", textClass("lead big")),
      text("e", textClass("lead big"), "bold"),
    ]);
  });

  it("marks everything inside the element, not only text", () => {
    expect(inline("<u>{count} ![](a.png)<br /><Icon /></u>\n")).toEqual([
      {
        type: "mdxInlineExpression",
        attrs: { value: "count" },
        marks: [{ type: "underline" }],
      },
      text(" ", "underline"),
      {
        type: "image",
        attrs: { src: "a.png", alt: "", title: null },
        marks: [{ type: "underline" }],
      },
      hardBreak("underline"),
      {
        type: "mdxInlineComponent",
        attrs: { name: "Icon", props: {}, spreads: [], hasChildren: false },
        content: [],
        marks: [{ type: "underline" }],
      },
    ]);
  });

  it.each([
    ['<span class="a" id="b">x</span>', { class: "a", id: "b" }],
    ['<span className="a">x</span>', { className: "a" }],
    ["<span class>x</span>", { class: true }],
    ["<span>x</span>", {}],
    ['<u title="t">x</u>', { title: "t" }],
    ['<small class="a">x</small>', { class: "a" }],
    ['<sup id="fn">x</sup>', { id: "fn" }],
  ])("keeps %s as a component", (source, props) => {
    expect(inline(`${source}\n`)).toMatchObject([
      { type: "mdxInlineComponent", attrs: { props, spreads: [] } },
    ]);
    expect(roundTrip(`${source}\n`)).toBe(`${source}\n`);
  });

  it("keeps an element with a spread or without children as a component", () => {
    expect(
      inline('<u {...rest}>x</u> <u /> <span class="a" />\n'),
    ).toMatchObject([
      {
        type: "mdxInlineComponent",
        attrs: { name: "u", spreads: ["...rest"] },
      },
      { type: "text" },
      { type: "mdxInlineComponent", attrs: { name: "u", hasChildren: false } },
      { type: "text" },
      { type: "mdxInlineComponent", attrs: { name: "span" } },
    ]);
  });

  it("keeps a multi-line element as a block", () => {
    const source = "<u>\n\nA paragraph.\n\n</u>\n";
    expect(parseMdx(source).doc.content).toMatchObject([
      { type: "mdxComponent", attrs: { name: "u" } },
    ]);
    expect(roundTrip(source)).toBe(source);
  });

  it("writes the same class once for adjacent text, twice across a gap", () => {
    expect(
      serializeMdx(
        doc(
          paragraph(
            text("a", textClass("x")),
            text("b", textClass("x"), "bold"),
            text(" c "),
            text("d", textClass("x")),
          ),
        ),
      ),
    ).toBe('<span class="x">a**b**</span> c <span class="x">d</span>\n');
  });

  it("escapes a class that holds a quote", () => {
    const source = '<span class="a &#x22;b&#x22;">x</span>\n';
    expect(inline(source)).toEqual([text("x", textClass('a "b"'))]);
    expect(roundTrip(source)).toBe(source);
  });

  it("writes them as raw HTML in Markdown", () => {
    const marked = doc(
      paragraph(
        text("a", "underline"),
        text("b", "small", "bold"),
        text("c", textClass('x "y"')),
        text("2", "superscript"),
      ),
    );
    const md =
      '<u>a</u>**<small>b</small>**<span class="x &quot;y&quot;">c</span><sup>2</sup>\n';
    expect(serializeMdx(marked, { format: "md" })).toBe(md);
    // Read back, the tags are raw HTML again: the same text, no marks.
    expect(roundTrip(md, "md")).toBe(md);
  });

  // Marks are read from `.mdx` only; a `.md` file keeps `<u>` as raw HTML,
  // so the toolbar offers these marks (like superscript) for MDX alone.
  it.fails("reads the raw HTML tags of a Markdown file back as marks", () => {
    expect(inline("<u>a</u>\n", "md")).toEqual([text("a", "underline")]);
  });

  it("writes the text of a mark it does not know", () => {
    expect(
      serializeMdx(doc(paragraph(text("a", "highlight"), text("b")))),
    ).toBe("ab\n");
  });
});

describe("line breaks", () => {
  it("reads <br /> as a hard break", () => {
    expect(inline("one<br />two<br></br>three\n")).toEqual([
      text("one"),
      hardBreak(),
      text("two"),
      hardBreak(),
      text("three"),
    ]);
  });

  it("keeps a <br /> with attributes as a component", () => {
    const source = 'one<br class="clear" />two\n';
    expect(inline(source)).toMatchObject([
      { type: "text" },
      { type: "mdxInlineComponent", attrs: { name: "br" } },
      { type: "text" },
    ]);
    expect(roundTrip(source)).toBe(source);
  });

  it("keeps the marks around a break", () => {
    expect(inline("**one\\\ntwo**\n")).toEqual([
      text("one", "bold"),
      hardBreak("bold"),
      text("two", "bold"),
    ]);
  });

  const cell = (type: string, ...content: PMNode[]): PMNode => ({
    type,
    attrs: { align: null },
    content,
  });
  const table = (...cells: PMNode[][]): PMNode => ({
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [cell("tableHeader", paragraph(text("H")))],
      },
      { type: "tableRow", content: [cell("tableCell", ...cells[0])] },
    ],
  });

  it.each([
    ["mdx", "<br />"],
    ["md", "<br>"],
  ] as const)("writes a break in a %s table cell as %s", (format, br) => {
    const source = `| H${" ".repeat(br.length + 5)} |\n| ${"-".repeat(br.length + 6)} |\n| one${br}two |\n`;
    const tableDoc = doc(
      table([paragraph(text("one"), hardBreak(), text("two"))]),
    );
    expect(serializeMdx(tableDoc, { format })).toBe(source);
    expect(parseMdx(source, { format }).doc).toEqual(tableDoc);
  });

  it("joins the paragraphs of a table cell with breaks", () => {
    expect(
      serializeMdx(
        doc(
          table([
            paragraph(text("one")),
            paragraph(
              text("two", "bold"),
              hardBreak("bold"),
              text("three", "bold"),
            ),
          ]),
        ),
      ),
    ).toBe(
      "| H                           |\n| --------------------------- |\n| one<br />**two<br />three** |\n",
    );
  });

  it.each(["<br>", "<br/>", "<br />", "<BR>"])(
    "reads %s in a Markdown table cell as a hard break",
    (br) => {
      const source = `| H |\n| - |\n| one${br}two |\n`;
      expect(
        parseMdx(source, { format: "md" }).doc.content?.[0].content?.[1]
          .content?.[0].content?.[0].content,
      ).toEqual([text("one"), hardBreak(), text("two")]);
    },
  );

  it("leaves <br> elsewhere in Markdown as raw HTML", () => {
    const source = "one<br>two\n";
    expect(inline(source, "md")).toEqual([
      text("one"),
      { type: "rawInlineHtml", attrs: { value: "<br>" } },
      text("two"),
    ]);
    expect(roundTrip(source, "md")).toBe(source);
  });

  it("writes a break in a heading as an element", () => {
    const heading = doc({
      type: "heading",
      attrs: { level: 3 },
      content: [text("one"), hardBreak(), text("two")],
    });
    expect(serializeMdx(heading)).toBe("### one<br />two\n");
    expect(serializeMdx(heading, { format: "md" })).toBe("### one<br>two\n");
    expect(parseMdx("### one<br>two\n", { format: "md" }).doc).toEqual(heading);
  });

  it("writes a break that ends a paragraph as an element", () => {
    const ending = doc(paragraph(text("one"), hardBreak(), hardBreak()));
    expect(serializeMdx(ending)).toBe("one<br /><br />\n");
    expect(parseMdx("one<br /><br />\n").doc).toEqual(ending);
    expect(serializeMdx(ending, { format: "md" })).toBe("one<br><br>\n");
  });

  it("drops a paragraph of nothing but breaks, like an empty one", () => {
    expect(
      serializeMdx(
        doc(paragraph(hardBreak(), hardBreak()), paragraph(text("one"))),
      ),
    ).toBe("one\n");
  });

  it("moves a break out of the end of bold, where it cannot be written", () => {
    // What the editor leaves when a selection that ends at a break is made bold.
    expect(
      serializeMdx(
        doc(paragraph(text("one", "bold"), hardBreak("bold"), text("two"))),
      ),
    ).toBe("**one**\\\ntwo\n");
  });

  it("writes a break before a line of only elements as an element", () => {
    // MDX would read `<Icon />` alone on a line as a block.
    const source = "one<br /><Icon /> {two}\n";
    expect(roundTrip(source)).toBe(source);
    expect(roundTrip("one\\\n{two} three\n")).toBe("one\\\n{two} three\n");
  });
});

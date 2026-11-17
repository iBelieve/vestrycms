/**
 * Property tests for the MDX converter: documents the editor can produce
 * must survive a save and a reload. The fixtures cover syntax the parser
 * reads; these cover what the serializer writes for arbitrary editor content.
 */
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { parseMdx, serializeMdx } from "../src/mdx/index.js";
import type { PMMark, PMNode } from "../src/mdx/types.js";

// More runs locally with FC_RUNS=10000 pnpm test. A case takes a few
// milliseconds, so allow for that past the default 5 s timeout.
const runs = Number(process.env.FC_RUNS) || 200;
fc.configureGlobal({ numRuns: runs });
vi.setConfig({ testTimeout: Math.max(5_000, runs * 20) });

type Format = "md" | "mdx";

// ------------------------------------------------------------ generators

/** Characters that mean something to Markdown, MDX or GFM, plus filler. */
const CHARS = [
  ..."aaaabbc  ",
  ..."*_`~#>-+=.!|\\[](){}<>&:/@",
  ..."19",
  "é",
  "\t",
];

const textArb = fc
  .array(fc.constantFrom(...CHARS), { minLength: 1, maxLength: 8 })
  .map((cs) => cs.join(""));

const SIMPLE_MARKS = [
  "bold",
  "italic",
  "strike",
  "underline",
  "small",
  "superscript",
  "subscript",
] as const;

const markArb: fc.Arbitrary<PMMark> = fc.oneof(
  fc.constantFrom(...SIMPLE_MARKS).map((type) => ({ type })),
  fc
    .constantFrom("https://example.org", "/about", "a b", "x)y")
    .map((href) => ({ type: "link", attrs: { href, title: null } })),
  fc
    .constantFrom("lead", "text-red")
    .map((cls) => ({ type: "textClass", attrs: { class: cls } })),
);

/** A set of marks as the editor would hold it: code excludes every other mark. */
const marksArb: fc.Arbitrary<PMMark[]> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<PMMark[]>([{ type: "code" }]) },
  {
    weight: 6,
    arbitrary: fc.uniqueArray(markArb, {
      maxLength: 3,
      selector: (m) => m.type,
    }),
  },
);

const inlineArb: fc.Arbitrary<PMNode> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc
      .record({ text: textArb, marks: marksArb })
      .map(({ text, marks }): PMNode => ({
        type: "text",
        text,
        ...(marks.length ? { marks } : {}),
      })),
  },
  { weight: 1, arbitrary: fc.constant<PMNode>({ type: "hardBreak" }) },
);

/** Adjacent text with the same marks is one node, as ProseMirror keeps it. */
const inlinesArb = fc
  .array(inlineArb, { minLength: 1, maxLength: 6 })
  .map((nodes) =>
    nodes.reduce<PMNode[]>((out, node) => {
      const prev = out.at(-1);
      if (
        prev?.type === "text" &&
        node.type === "text" &&
        JSON.stringify(prev.marks) === JSON.stringify(node.marks)
      )
        out[out.length - 1] = { ...prev, text: prev.text! + node.text! };
      else out.push(node);
      return out;
    }, []),
  );

const paragraphArb = inlinesArb
  // KNOWN: MDX drops the content of an element that holds only whitespace,
  // so a paragraph of nothing but a styled space reads back as an empty
  // component.
  .filter((content) => content.some((n) => /\S/.test(n.text ?? "")))
  .map((content): PMNode => ({ type: "paragraph", content }));

const headingArb = fc
  .record({ level: fc.integer({ min: 1, max: 4 }), content: inlinesArb })
  .map(({ level, content }): PMNode => ({
    type: "heading",
    attrs: { level },
    content,
  }));

const codeBlockArb = fc
  .record({
    language: fc.constantFrom(null, "js"),
    text: fc
      .array(fc.constantFrom(..."ab `~\n<{"), { minLength: 1, maxLength: 12 })
      .map((cs) => cs.join("")),
  })
  .map(({ language, text }): PMNode => ({
    type: "codeBlock",
    attrs: { language, meta: null },
    content: [{ type: "text", text }],
  }));

/** Component props: anything JSON can hold, keyed by attribute-like names. */
const propsArb = fc.dictionary(
  fc.constantFrom("title", "count", "data-id", "items", "open"),
  fc.jsonValue({ maxDepth: 2 }),
  { maxKeys: 3 },
);

const componentArb = fc
  .record({
    name: fc.constantFrom("Callout", "Figure"),
    props: propsArb,
    content: fc.option(fc.array(paragraphArb, { minLength: 1, maxLength: 2 }), {
      nil: undefined,
    }),
  })
  .map(({ name, props, content }): PMNode => ({
    type: "mdxComponent",
    attrs: { name, props, spreads: [], hasChildren: Boolean(content) },
    content: content ?? [],
  }));

const cellArb = (type: string) =>
  inlinesArb
    // A table trims the whitespace around a cell's content.
    .filter((content) => {
      const text = content.map((n) => n.text ?? "").join("");
      return text === text.trim();
    })
    // KNOWN: mdast-util-gfm-table writes `\|` in inline code in a cell as
    // `\\|`, and micromark ends the cell at that pipe.
    .filter(
      (content) =>
        !content.some(
          (n) =>
            n.marks?.some((m) => m.type === "code") &&
            /\\\|/.test(n.text ?? ""),
        ),
    )
    .map((content): PMNode => ({
      type,
      attrs: { align: null },
      content: [{ type: "paragraph", content }],
    }));

const tableArb = fc
  .record({
    columns: fc.integer({ min: 1, max: 3 }),
    rows: fc.integer({ min: 0, max: 2 }),
  })
  .chain(({ columns, rows }) =>
    fc.tuple(
      fc.array(cellArb("tableHeader"), {
        minLength: columns,
        maxLength: columns,
      }),
      fc.array(
        fc.array(cellArb("tableCell"), {
          minLength: columns,
          maxLength: columns,
        }),
        { minLength: rows, maxLength: rows },
      ),
    ),
  )
  .map(([header, body]): PMNode => ({
    type: "table",
    content: [header, ...body].map((content) => ({
      type: "tableRow",
      content,
    })),
  }));

/** Blocks at any depth; an MDX document also holds components. */
const blockArb = (format: Format) =>
  fc.letrec<{ block: PMNode }>((tie) => ({
    block: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      { weight: 6, arbitrary: paragraphArb },
      { weight: 2, arbitrary: headingArb },
      { weight: 1, arbitrary: codeBlockArb },
      { weight: 1, arbitrary: fc.constant({ type: "horizontalRule" }) },
      { weight: 1, arbitrary: tableArb },
      { weight: format === "mdx" ? 1 : 0, arbitrary: componentArb },
      {
        weight: 1,
        arbitrary: fc
          .array(tie("block"), { minLength: 1, maxLength: 3 })
          .map((content) => ({ type: "blockquote", content })),
      },
      {
        weight: 2,
        arbitrary: fc
          .record({
            ordered: fc.boolean(),
            spread: fc.boolean(),
            items: fc.array(
              fc
                .array(tie("block"), { minLength: 1, maxLength: 2 })
                // KNOWN: mdast-util-to-markdown writes an item that starts
                // with a rule with the other bullet (`* ---`), so a list
                // after it, which also switches bullets, joins it.
                .filter((blocks) => blocks[0].type !== "horizontalRule"),
              { minLength: 1, maxLength: 3 },
            ),
          })
          .map(({ ordered, spread, items }) => ({
            type: ordered ? "orderedList" : "bulletList",
            attrs: ordered ? { start: 1, spread } : { spread },
            content: items.map((content) => ({
              type: "listItem",
              attrs: {},
              content,
            })),
          })),
      },
    ),
  })).block;

const docArb = (format: Format) =>
  fc
    .array(blockArb(format), { minLength: 1, maxLength: 4 })
    .map((content): PMNode => ({ type: "doc", content }))
    .filter((doc) => !listInQuote(doc));

const docArbs = { md: docArb("md"), mdx: docArb("mdx") };

/**
 * KNOWN: micromark misjudges a list's looseness inside a blockquote: a
 * blank line between items can leave it tight (`> - - a\n>\n> - b`) and
 * one after it can make it loose (`> - a\n>\n> * b`), so a list there may
 * be written loose and read back tight, or the other way round.
 */
function listInQuote(node: PMNode, quoted = false): boolean {
  if (quoted && (node.type === "bulletList" || node.type === "orderedList"))
    return true;
  return (node.content ?? []).some((n) =>
    listInQuote(n, quoted || node.type === "blockquote"),
  );
}

// ------------------------------------------------------------ comparison

/**
 * What a save must keep: the blocks, and for each run of inline content
 * every character with the marks on it. Marks on a hard break, and empty or
 * break-only paragraphs, are dropped by design (see serialize.ts).
 */
function essence(node: PMNode, format: Format): unknown {
  if (node.type === "codeBlock")
    return ["code", (node.content ?? []).map((t) => t.text).join("")];
  if (node.type === "paragraph" || node.type === "heading") {
    const chars: string[] = [];
    for (const n of node.content ?? []) {
      // A Markdown file writes a break that cannot be a backslash as raw
      // `<br>`, which reads back as raw HTML outside headings and cells.
      if (n.type === "hardBreak" || isHtmlBreak(n)) chars.push("⏎");
      else
        for (const c of n.text ?? "") chars.push(`${c} ${marksOf(n, format)}`);
    }
    return [node.type, node.attrs?.level ?? null, chars];
  }
  if (node.type === "mdxComponent")
    return [
      node.type,
      node.attrs?.name,
      // As JSON, which has no -0.
      JSON.stringify(node.attrs?.props),
      (node.content ?? []).map((n) => essence(n, format)),
    ];
  const content = (node.content ?? [])
    .filter((n) => !isEmptyParagraph(n))
    .map((n) => essence(n, format));
  return [node.type, content];
}

/**
 * Marks written as HTML tags in a Markdown file are read back as raw HTML
 * around the text, not as marks (a known gap, see mdx.test.ts), so only the
 * text is compared there.
 */
const HTML_MARKS = new Set([
  "underline",
  "small",
  "superscript",
  "subscript",
  "textClass",
]);

function marksOf(node: PMNode, format: Format) {
  return (node.marks ?? [])
    .filter((m) => format === "mdx" || !HTML_MARKS.has(m.type))
    .map(markName)
    .sort()
    .join(",");
}

function markName(m: PMMark) {
  return m.attrs ? `${m.type}(${JSON.stringify(m.attrs)})` : m.type;
}

function isHtmlBreak(n: PMNode) {
  return n.type === "rawInlineHtml" && n.attrs?.value === "<br>";
}

function isEmptyParagraph(n: PMNode) {
  return (
    n.type === "paragraph" &&
    (n.content ?? []).every((c) => c.type === "hardBreak")
  );
}

function save(doc: PMNode, format: Format) {
  return serializeMdx(doc, { format });
}

function load(source: string, format: Format) {
  return parseMdx(source, { format }).doc;
}

// ------------------------------------------------------------ properties

/**
 * KNOWN: in Markdown, mdast-util-to-markdown escapes a `<` only before what
 * could start a tag, but an email autolink's local part may begin with a
 * digit or punctuation, a backtick included, so text such as `<1@a>`, or `<`
 * before inline code `` `a@b.c>` ``, reads back as a mailto link.
 */
function autolinkHazard(source: string, format: Format) {
  return format === "md" && /<[^\s<>]*@/.test(source);
}

/**
 * KNOWN: mdast-util-to-markdown writes a letter next to a delimiter as a
 * character reference (`~~a~~&#x61;`), then judges the `_` or `*` after it
 * as if a letter preceded it. In the source a `;` does, so it can open
 * emphasis (`&#x61;_a … _`); across an element, MDX cannot parse the file.
 */
function entityHazard(source: string) {
  return /&#x[0-9a-f]+;[_*]/i.test(source);
}

function knownHazard(source: string, format: Format) {
  return autolinkHazard(source, format) || entityHazard(source);
}

describe.each<Format>(["mdx", "md"])("%s save and reload", (format) => {
  it("writes a file that saves back unchanged", () => {
    fc.assert(
      fc.property(docArbs[format], (doc) => {
        const once = save(doc, format);
        fc.pre(!knownHazard(once, format));
        expect(save(load(once, format), format)).toBe(once);
      }),
    );
  });

  it("keeps every block, character and mark", () => {
    fc.assert(
      fc.property(docArbs[format], (doc) => {
        const once = save(doc, format);
        fc.pre(!knownHazard(once, format));
        expect(essence(load(once, format), format)).toEqual(
          essence(doc, format),
        );
      }),
    );
  });
});

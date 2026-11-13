import type * as Md from "mdast";
import type {
  MdxFlowExpression,
  MdxJsxAttribute,
  MdxJsxExpressionAttribute,
  MdxJsxFlowElement,
  MdxJsxTextElement,
  MdxTextExpression,
  MdxjsEsm,
} from "mdast-util-mdx";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { gfm } from "micromark-extension-gfm";
import { mdxjs } from "micromark-extension-mdxjs";
import type * as ES from "estree";
import { estreeToValue } from "./expressions.js";
import type { ImportSpec, PMMark, PMNode, ParsedDocument } from "./types.js";

type AnyNode =
  | Md.Nodes
  | MdxJsxFlowElement
  | MdxJsxTextElement
  | MdxFlowExpression
  | MdxTextExpression
  | MdxjsEsm;

/** Inline HTML tags that are edited as marks rather than as components. */
const MARK_TAGS: Record<string, string> = {
  sup: "superscript",
  sub: "subscript",
  u: "underline",
  small: "small",
};

/** A raw HTML line break, which Markdown needs where it has no hard break. */
const HTML_BREAK = /^<br\s*\/?>$/i;

export interface ParseOptions {
  /** `md` disables JSX/ESM parsing (raw HTML is preserved as html nodes). */
  format?: "md" | "mdx";
}

export function parseMdx(
  source: string,
  options: ParseOptions = {},
): ParsedDocument {
  const isMdx = options.format !== "md";
  const tree = fromMarkdown(source, {
    extensions: isMdx ? [mdxjs(), gfm()] : [gfm()],
    mdastExtensions: isMdx
      ? [mdxFromMarkdown(), gfmFromMarkdown()]
      : [gfmFromMarkdown()],
  });
  const ctx: Ctx = { imports: {}, definitions: new Map() };
  collectDefinitions(tree, ctx);
  const content = blocks(tree.children as AnyNode[], ctx);
  return {
    doc: {
      type: "doc",
      content: content.length ? content : [{ type: "paragraph" }],
    },
    imports: ctx.imports,
  };
}

interface Ctx {
  imports: Record<string, ImportSpec>;
  definitions: Map<string, Md.Definition>;
  /**
   * Inside a table cell or heading of a Markdown file, where a hard break can
   * only be written as raw HTML (`<br>`); see `htmlBreaks` in the serializer.
   */
  htmlBreaks?: boolean;
}

function collectDefinitions(tree: Md.Root, ctx: Ctx) {
  const visit = (node: Md.Node) => {
    if (node.type === "definition") {
      const d = node as Md.Definition;
      ctx.definitions.set(d.identifier.toLowerCase(), d);
    }
    const children = (node as Md.Parent).children;
    if (children) children.forEach(visit);
  };
  visit(tree);
}

function blocks(nodes: AnyNode[], ctx: Ctx): PMNode[] {
  const out: PMNode[] = [];
  for (const node of nodes) {
    const converted = block(node, ctx);
    if (converted)
      out.push(...(Array.isArray(converted) ? converted : [converted]));
  }
  return out;
}

function block(node: AnyNode, ctx: Ctx): PMNode | PMNode[] | null {
  switch (node.type) {
    case "paragraph":
      return {
        type: "paragraph",
        content: inlines(node.children as AnyNode[], ctx),
      };
    case "heading":
      return {
        type: "heading",
        attrs: { level: node.depth },
        content: lineInlines(node.children as AnyNode[], ctx),
      };
    case "thematicBreak":
      return { type: "horizontalRule" };
    case "blockquote":
      return {
        type: "blockquote",
        content: ensureBlocks(blocks(node.children as AnyNode[], ctx)),
      };
    case "list": {
      const items = node.children.map((item) => listItem(item, ctx));
      const spread = Boolean(node.spread);
      return node.ordered
        ? {
            type: "orderedList",
            attrs: { start: node.start ?? 1, spread },
            content: items,
          }
        : { type: "bulletList", attrs: { spread }, content: items };
    }
    case "code":
      return {
        type: "codeBlock",
        attrs: { language: node.lang ?? null, meta: node.meta ?? null },
        content: node.value ? [{ type: "text", text: node.value }] : [],
      };
    case "html":
      return { type: "rawHtml", attrs: { value: node.value } };
    case "table":
      return table(node, ctx);
    case "definition":
      return null;
    case "footnoteDefinition":
      return {
        type: "footnoteDefinition",
        attrs: footnoteAttrs(node),
        content: ensureBlocks(blocks(node.children as AnyNode[], ctx)),
      };
    case "mdxJsxFlowElement":
      return jsxBlock(node, ctx);
    case "mdxFlowExpression":
      return { type: "mdxExpression", attrs: { value: node.value } };
    case "mdxjsEsm":
      return esm(node, ctx);
    case "yaml":
      return null;
    default: {
      // Inline content at block level (shouldn't happen) – wrap in a paragraph.
      const inline = inlineNode(node, ctx, []);
      return inline.length ? { type: "paragraph", content: inline } : null;
    }
  }
}

function ensureBlocks(content: PMNode[]): PMNode[] {
  return content.length ? content : [{ type: "paragraph" }];
}

function footnoteAttrs(node: Md.FootnoteDefinition | Md.FootnoteReference) {
  return { identifier: node.identifier, label: node.label ?? node.identifier };
}

function listItem(item: Md.ListItem, ctx: Ctx): PMNode {
  const content = ensureBlocks(blocks(item.children as AnyNode[], ctx));
  return {
    type: "listItem",
    attrs:
      item.checked === null || item.checked === undefined
        ? {}
        : { checked: item.checked },
    content,
  };
}

function table(node: Md.Table, ctx: Ctx): PMNode {
  const rows = node.children.map((row, rowIdx) => ({
    type: "tableRow",
    content: row.children.map((cell, colIdx) => ({
      type: rowIdx === 0 ? "tableHeader" : "tableCell",
      attrs: { align: node.align?.[colIdx] ?? null },
      content: [
        {
          type: "paragraph",
          content: lineInlines(cell.children as AnyNode[], ctx),
        },
      ],
    })),
  }));
  return { type: "table", content: rows };
}

function esm(node: MdxjsEsm, ctx: Ctx): PMNode | null {
  const program = node.data?.estree as ES.Program | undefined;
  // Estree offsets count from the start of the file, not of this block.
  const base = node.position?.start.offset;
  if (!program || typeof base !== "number")
    return { type: "mdxEsm", attrs: { value: node.value } };
  // Cut recognized imports out of the block's source; everything else,
  // comments and blank lines included, stays as written.
  let rest = "";
  let pos = 0;
  for (const stmt of program.body) {
    const { start, end } = stmt as ES.Node & { start?: number; end?: number };
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!recordImport(stmt, ctx)) continue;
    rest += node.value.slice(pos, start - base);
    pos = end - base;
    // Drop the rest of the line when only whitespace follows the import.
    const eol = /^[ \t]*(\r?\n|$)/.exec(node.value.slice(pos));
    if (eol) pos += eol[0].length;
  }
  rest = (rest + node.value.slice(pos)).trim();
  return rest ? { type: "mdxEsm", attrs: { value: rest } } : null;
}

/**
 * Record an import statement's bindings if all of them can be re-emitted from
 * ImportSpecs; the caller then drops the statement. Otherwise it is kept
 * verbatim.
 */
function recordImport(stmt: ES.Node, ctx: Ctx): boolean {
  if (
    stmt.type !== "ImportDeclaration" ||
    typeof stmt.source.value !== "string"
  )
    return false;
  const from = stmt.source.value;
  const specs: ImportSpec[] = [];
  for (const spec of stmt.specifiers) {
    if (spec.type === "ImportDefaultSpecifier") {
      specs.push({ name: spec.local.name, from });
    } else if (spec.type === "ImportSpecifier") {
      const imported =
        spec.imported.type === "Identifier"
          ? spec.imported.name
          : String(spec.imported.value);
      specs.push({
        name: spec.local.name,
        from,
        named: true,
        ...(imported === spec.local.name ? {} : { imported }),
      });
    } else {
      return false;
    }
  }
  if (!specs.length) return false;
  for (const spec of specs) ctx.imports[spec.name] = spec;
  return true;
}

function attrsToProps(
  attributes: (MdxJsxAttribute | MdxJsxExpressionAttribute)[],
): {
  props: Record<string, unknown>;
  spreads: string[];
} {
  const props: Record<string, unknown> = {};
  const spreads: string[] = [];
  for (const attr of attributes) {
    if (attr.type === "mdxJsxExpressionAttribute") {
      spreads.push(attr.value);
      continue;
    }
    if (attr.value === null || attr.value === undefined) {
      props[attr.name] = true;
    } else if (typeof attr.value === "string") {
      props[attr.name] = attr.value;
    } else {
      const estree = attr.value.data?.estree as ES.Program | undefined;
      props[attr.name] = estreeToValue(estree, attr.value.value);
    }
  }
  return { props, spreads };
}

/**
 * The mark an inline element stands for, if any: `<u>`, `<small>`, `<sup>` and
 * `<sub>` without attributes, and a `<span>` whose only attribute is a string
 * `class`. Anything else (and an element without children, which a mark
 * could not represent) stays a component, so nothing is lost on save.
 */
function jsxMark(node: MdxJsxFlowElement | MdxJsxTextElement): PMMark | null {
  if (!node.children.length) return null;
  const name = node.name ?? "";
  if (!node.attributes.length)
    return Object.hasOwn(MARK_TAGS, name) ? { type: MARK_TAGS[name] } : null;
  const [attr] = node.attributes;
  if (
    name === "span" &&
    node.attributes.length === 1 &&
    attr.type === "mdxJsxAttribute" &&
    attr.name === "class" &&
    typeof attr.value === "string"
  )
    return { type: "textClass", attrs: { class: attr.value } };
  return null;
}

/** An element within a paragraph: a line break, a mark on its children, or an inline component. */
function jsxInline(
  node: MdxJsxFlowElement | MdxJsxTextElement,
  ctx: Ctx,
  marks: PMMark[],
): PMNode[] {
  const name = node.name ?? "";
  const children = node.children as AnyNode[];
  if (name === "br" && !node.attributes.length && !children.length)
    return [withMarks({ type: "hardBreak" }, marks)];
  const mark = jsxMark(node);
  if (mark) return inlines(children, ctx, [...marks, mark]);
  const { props, spreads } = attrsToProps(node.attributes);
  return [
    withMarks(
      {
        type: "mdxInlineComponent",
        attrs: { name, props, spreads, hasChildren: children.length > 0 },
        content: inlines(children, ctx),
      },
      marks,
    ),
  ];
}

function jsxBlock(node: MdxJsxFlowElement, ctx: Ctx): PMNode {
  const name = node.name ?? "";
  const { props, spreads } = attrsToProps(node.attributes);
  const children = node.children as AnyNode[];
  // Children may be flow content or phrasing content (MDX allows
  // `<Foo>text</Foo>`); normalise to blocks.
  const hasFlowChildren = children.some((c) => !isPhrasing(c));
  const content = hasFlowChildren
    ? blocks(children, ctx)
    : children.length
      ? [{ type: "paragraph", content: inlines(children, ctx) }]
      : [];
  return {
    type: "mdxComponent",
    attrs: { name, props, spreads, hasChildren: content.length > 0 },
    content,
  };
}

const PHRASING = new Set([
  "text",
  "emphasis",
  "strong",
  "delete",
  "inlineCode",
  "link",
  "linkReference",
  "image",
  "imageReference",
  "break",
  "html",
  "footnoteReference",
  "mdxJsxTextElement",
  "mdxTextExpression",
]);

function isPhrasing(node: AnyNode): boolean {
  return PHRASING.has(node.type);
}

function inlines(nodes: AnyNode[], ctx: Ctx, marks: PMMark[] = []): PMNode[] {
  const out: PMNode[] = [];
  for (const node of nodes) out.push(...inlineNode(node, ctx, marks));
  return mergeText(out);
}

/** The content of a table cell or heading, which cannot hold a Markdown hard break. */
function lineInlines(nodes: AnyNode[], ctx: Ctx): PMNode[] {
  const outer = ctx.htmlBreaks;
  ctx.htmlBreaks = true;
  try {
    return inlines(nodes, ctx);
  } finally {
    ctx.htmlBreaks = outer;
  }
}

function withMarks(node: PMNode, marks: PMMark[]): PMNode {
  return marks.length
    ? { ...node, marks: [...(node.marks ?? []), ...marks] }
    : node;
}

function inlineNode(node: AnyNode, ctx: Ctx, marks: PMMark[]): PMNode[] {
  switch (node.type) {
    case "text":
      return node.value
        ? [withMarks({ type: "text", text: node.value }, marks)]
        : [];
    case "emphasis":
      return inlines(node.children as AnyNode[], ctx, [
        ...marks,
        { type: "italic" },
      ]);
    case "strong":
      return inlines(node.children as AnyNode[], ctx, [
        ...marks,
        { type: "bold" },
      ]);
    case "delete":
      return inlines(node.children as AnyNode[], ctx, [
        ...marks,
        { type: "strike" },
      ]);
    case "inlineCode":
      return [
        withMarks({ type: "text", text: node.value }, [
          ...marks,
          { type: "code" },
        ]),
      ];
    case "link":
      return inlines(node.children as AnyNode[], ctx, [
        ...marks,
        { type: "link", attrs: { href: node.url, title: node.title ?? null } },
      ]);
    case "linkReference": {
      const def = ctx.definitions.get(node.identifier.toLowerCase());
      if (!def) return inlines(node.children as AnyNode[], ctx, marks);
      return inlines(node.children as AnyNode[], ctx, [
        ...marks,
        { type: "link", attrs: { href: def.url, title: def.title ?? null } },
      ]);
    }
    case "image":
      return [
        withMarks(
          {
            type: "image",
            attrs: {
              src: node.url,
              alt: node.alt ?? null,
              title: node.title ?? null,
            },
          },
          marks,
        ),
      ];
    case "imageReference": {
      const def = ctx.definitions.get(node.identifier.toLowerCase());
      return def
        ? [
            withMarks(
              {
                type: "image",
                attrs: {
                  src: def.url,
                  alt: node.alt ?? null,
                  title: def.title ?? null,
                },
              },
              marks,
            ),
          ]
        : [];
    }
    case "break":
      return [withMarks({ type: "hardBreak" }, marks)];
    case "html":
      if (ctx.htmlBreaks && HTML_BREAK.test(node.value))
        return [withMarks({ type: "hardBreak" }, marks)];
      return [
        withMarks(
          { type: "rawInlineHtml", attrs: { value: node.value } },
          marks,
        ),
      ];
    case "footnoteReference":
      return [
        withMarks(
          { type: "footnoteReference", attrs: footnoteAttrs(node) },
          marks,
        ),
      ];
    case "mdxJsxTextElement":
    case "mdxJsxFlowElement":
      return jsxInline(node, ctx, marks);
    case "mdxTextExpression":
      return [
        withMarks(
          { type: "mdxInlineExpression", attrs: { value: node.value } },
          marks,
        ),
      ];
    default: {
      // Block content inside inline context: flatten to text.
      const children = (node as Md.Parent).children as AnyNode[] | undefined;
      return children ? inlines(children, ctx, marks) : [];
    }
  }
}

function mergeText(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.type === "text" &&
      n.type === "text" &&
      sameMarks(prev.marks, n.marks)
    ) {
      prev.text = (prev.text ?? "") + (n.text ?? "");
    } else {
      out.push({ ...n });
    }
  }
  return out;
}

function sameMarks(a?: PMMark[], b?: PMMark[]): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

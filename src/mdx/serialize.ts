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
import { gfmToMarkdown } from "mdast-util-gfm";
import { mdxToMarkdown } from "mdast-util-mdx";
import {
  defaultHandlers,
  toMarkdown,
  type Info,
  type State,
} from "mdast-util-to-markdown";
import { isPlainString, valueToSource } from "./expressions.js";
import type { ComponentRegistry, ImportSpec, PMMark, PMNode } from "./types.js";

type AnyNode =
  | Md.Nodes
  | MdxJsxFlowElement
  | MdxJsxTextElement
  | MdxFlowExpression
  | MdxTextExpression
  | MdxjsEsm;

/**
 * Serializer state: the target syntax, and what the document references (to
 * decide which imports to emit).
 */
interface Uses {
  /** MDX writes marks and breaks as JSX; Markdown gets the same tags as raw HTML. */
  mdx: boolean;
  /** Capitalized JSX element names. */
  components: Set<string>;
  /** Identifier-like words in expressions, attribute values and ESM. */
  identifiers: Set<string>;
}

/**
 * Note every identifier-like word in a piece of JS source. Words inside
 * strings or comments count too, which at worst keeps an unused import.
 */
function scan(source: string, used: Uses) {
  for (const m of source.matchAll(IDENTIFIERS)) used.identifiers.add(m[0]);
}

const IDENTIFIER = "[\\p{ID_Start}$_][\\p{ID_Continue}$\\u200c\\u200d]*";
const IDENTIFIERS = new RegExp(IDENTIFIER, "gu");
const IS_IDENTIFIER = new RegExp(`^${IDENTIFIER}$`, "u");

export interface SerializeOptions {
  format?: "md" | "mdx";
  /** Known components; used to emit imports for the ones the document uses. */
  components?: ComponentRegistry;
  /** Imports that were present in the source (used for components not in the registry). */
  existingImports?: Record<string, ImportSpec>;
}

export function serializeMdx(
  doc: PMNode,
  options: SerializeOptions = {},
): string {
  const isMdx = options.format !== "md";
  const used: Uses = {
    mdx: isMdx,
    components: new Set(),
    identifiers: new Set(),
  };
  const root: Md.Root = {
    type: "root",
    children: blocks(doc.content ?? [], used) as Md.RootContent[],
  };

  const imports = isMdx ? importStatements(used, options) : [];
  if (imports.length) {
    root.children.unshift({
      type: "mdxjsEsm",
      value: imports.join("\n"),
    });
  }

  const mdx = mdxToMarkdown({ quote: '"' });
  const libFlow = findHandler(mdx, "mdxJsxFlowElement");
  let out = toMarkdown(root, {
    extensions: isMdx ? [mdx, gfmToMarkdown()] : [gfmToMarkdown()],
    bullet: "-",
    bulletOther: "*",
    emphasis: "_",
    strong: "*",
    fences: true,
    rule: "-",
    listItemIndent: "one",
    resourceLink: true,
    join: [tightJoin],
    handlers: {
      rawHtml: (node: { value: string }) => node.value,
      rawInlineHtml: (node: { value: string }) => node.value,
      ...(libFlow ? { mdxJsxFlowElement: flowElementHandler(libFlow) } : {}),
      list: listHandler(defaultHandlers.list as Handler),
    } as never,
  });
  // Place a blank line after the import block like Prettier/MDX conventions.
  out = out.replace(/\s+$/, "");
  return out ? `${out}\n` : "";
}

type Handler = (
  node: unknown,
  parent: unknown,
  state: State,
  info: Info,
) => string;

interface ExtensionLike {
  extensions?: ExtensionLike[] | null;
  handlers?: Record<string, unknown> | null;
}

function findHandler(ext: ExtensionLike, name: string): Handler | undefined {
  const own = ext.handlers?.[name];
  if (typeof own === "function") return own as Handler;
  for (const sub of ext.extensions ?? []) {
    const found = findHandler(sub, name);
    if (found) return found;
  }
  return undefined;
}

/**
 * Block components with children are written with blank lines around the
 * children and no indentation:
 *
 *     <Article>
 *
 *     ## Heading
 *
 *     </Article>
 *
 * The library default indents children, which Prettier's MDX parser then
 * reflows as JSX text.
 */
function flowElementHandler(lib: Handler): Handler {
  return (node, parent, state, info) => {
    const el = node as MdxJsxFlowElement;
    if (!el.children?.length) return lib(node, parent, state, info);
    const open = lib({ ...el, children: [] }, parent, state, info).replace(
      /\s*\/>$/,
      ">",
    );
    const children = state.containerFlow(el, info);
    return `${open}\n\n${children}\n\n</${el.name ?? ""}>`;
  };
}

/**
 * A tight list is written without blank lines, but some neighbouring blocks
 * need one to stay apart (two paragraphs would merge, kind 7 HTML would join
 * the paragraph before it, ...), and a blank line anywhere in a list makes it
 * loose when read back. Ask the serializer's own join rules whether any
 * neighbours in the list or its items need a blank line, and if so write the
 * whole list loose.
 */
function listHandler(lib: Handler): Handler {
  return (node, parent, state, info) => {
    const list = node as Md.List;
    if (
      !list.spread &&
      ([list, ...list.children].some((p) => needsBlankLine(p, state)) ||
        list.children.some(holdsBlankLine))
    ) {
      list.spread = true;
      for (const item of list.children) item.spread = true;
    }
    return lib(node, parent, state, info);
  };
}

/**
 * A block component with children is written with blank lines around them
 * (see flowElementHandler), and CommonMark reads an item holding one as
 * loose.
 */
function holdsBlankLine(item: Md.ListItem): boolean {
  return (item.children as AnyNode[]).some(
    (n) => n.type === "mdxJsxFlowElement" && n.children.length > 0,
  );
}

/** Blocks whose first line ends a table rather than becoming one of its rows. */
const ENDS_TABLE = new Set([
  "blockquote",
  "code",
  "footnoteDefinition",
  "heading",
  "list",
  "mdxFlowExpression",
  "mdxJsxFlowElement",
  "thematicBreak",
]);

/**
 * Blocks that would continue a paragraph or table ending a quote or list
 * just before them, on lines read as lazy: a table's rows join the
 * paragraph, and a JSX tag or expression that spans lines fails to parse.
 */
const LAZY_HAZARDS = new Set([
  "table",
  "mdxJsxFlowElement",
  "mdxFlowExpression",
]);

/**
 * Joins in a tight list where the library's own rules would write no blank
 * line:
 *
 * - after a table, whose rows run on until a blank line, so the next line
 *   would become a row (`| a |` + newline + `  text`) unless it starts a
 *   block that ends the table;
 * - before a table, JSX element or expression that follows a quote or list
 *   ending in a paragraph or table (`- > a` + newline + `  | b |`). One
 *   right after a plain paragraph interrupts it.
 */
function tightJoin(
  left: Md.Nodes,
  right: Md.Nodes,
  parent: Md.Parent,
): 1 | undefined {
  if (!("spread" in parent)) return undefined;
  if (left.type === "table" && !ENDS_TABLE.has(right.type)) return 1;
  if (!LAZY_HAZARDS.has(right.type)) return undefined;
  let tail = left;
  while (
    (tail.type === "blockquote" ||
      tail.type === "list" ||
      tail.type === "listItem") &&
    tail.children.length
  )
    tail = tail.children[tail.children.length - 1];
  return tail !== left && (tail.type === "paragraph" || tail.type === "table")
    ? 1
    : undefined;
}

/** Mirrors mdast-util-to-markdown's `between`: tight only if a join says 0. */
function needsBlankLine(parent: Md.List | Md.ListItem, state: State): boolean {
  const children = parent.children as Md.Nodes[];
  for (let i = 1; i < children.length; i++) {
    if (linesBetween(children[i - 1], children[i], parent, state) !== 0)
      return true;
  }
  return false;
}

/**
 * The blank lines the first join with an opinion puts between two nodes. A
 * join that says `true`, or none at all, means one; `false` means one with a
 * comment in it.
 */
function linesBetween(
  left: Md.Nodes,
  right: Md.Nodes,
  parent: Md.List | Md.ListItem,
  state: State,
): number {
  for (let index = state.join.length - 1; index >= 0; index--) {
    const result = state.join[index](
      left as never,
      right as never,
      parent,
      state,
    );
    if (typeof result === "number") return result;
    if (typeof result === "boolean") return 1;
  }
  return 1;
}

function importStatements(used: Uses, options: SerializeOptions): string[] {
  const lines = new Map<string, string>();
  const add = (name: string, spec: ImportSpec | undefined) => {
    if (spec) lines.set(name, importLine(spec));
  };
  // Components get the registry's import, falling back to the source's.
  for (const name of used.components) {
    const reg = options.components?.[name];
    add(
      name,
      reg?.import
        ? { name, from: reg.import, named: reg.namedImport }
        : options.existingImports?.[name],
    );
  }
  // Anything else the source imported stays while it is still referenced.
  for (const [name, spec] of Object.entries(options.existingImports ?? {}))
    if (!lines.has(name) && used.identifiers.has(name)) add(name, spec);
  const originalOrder = Object.keys(options.existingImports ?? {});
  return [...lines.entries()]
    .sort(([a], [b]) => {
      const ia = originalOrder.indexOf(a);
      const ib = originalOrder.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    })
    .map(([, l]) => l);
}

function importLine(spec: ImportSpec): string {
  const from = JSON.stringify(spec.from);
  if (!spec.named) return `import ${spec.name} from ${from};`;
  const imported =
    spec.imported === undefined || spec.imported === spec.name
      ? ""
      : IS_IDENTIFIER.test(spec.imported)
        ? `${spec.imported} as `
        : `${JSON.stringify(spec.imported)} as `;
  return `import { ${imported}${spec.name} } from ${from};`;
}

function blocks(nodes: PMNode[], used: Uses): AnyNode[] {
  const out: AnyNode[] = [];
  for (const node of nodes) {
    const converted = block(node, used);
    if (converted) out.push(converted);
  }
  return out;
}

function block(node: PMNode, used: Uses): AnyNode | null {
  const convert = Object.hasOwn(BLOCKS, node.type)
    ? BLOCKS[node.type]
    : undefined;
  return convert ? convert(node, used) : paragraph([node], used);
}

/** How each kind of block is written, by its type in the editor. */
const BLOCKS: Record<string, (node: PMNode, used: Uses) => AnyNode | null> = {
  paragraph: (node, used) => paragraph(node.content ?? [], used),
  heading: (node, used) => ({
    type: "heading",
    depth: clampDepth(Number(node.attrs?.level ?? 1)),
    children: htmlBreaks(
      inlines(node.content ?? [], used),
      used,
    ) as Md.PhrasingContent[],
  }),
  horizontalRule: () => ({ type: "thematicBreak" }),
  blockquote: (node, used) => ({
    type: "blockquote",
    children: blocks(node.content ?? [], used) as Md.BlockContent[],
  }),
  bulletList: list,
  orderedList: list,
  codeBlock: (node) => ({
    type: "code",
    lang: (node.attrs?.language as string | null) ?? null,
    meta: (node.attrs?.meta as string | null) ?? null,
    value: (node.content ?? []).map((t) => t.text ?? "").join(""),
  }),
  rawHtml: (node) => ({ type: "html", value: String(node.attrs?.value ?? "") }),
  table,
  mdxComponent: (node, used) => jsxElement(node, used, false),
  footnoteDefinition: (node, used) => ({
    type: "footnoteDefinition",
    ...footnoteLabel(node),
    children: blocks(node.content ?? [], used) as Md.BlockContent[],
  }),
  mdxExpression: (node, used) => ({
    type: "mdxFlowExpression",
    value: scanned(node, used),
  }),
  mdxEsm: (node, used) => ({ type: "mdxjsEsm", value: scanned(node, used) }),
};

/** A node's `value` attribute, with the identifiers it uses recorded. */
function scanned(node: PMNode, used: Uses): string {
  const value = String(node.attrs?.value ?? "");
  scan(value, used);
  return value;
}

function list(node: PMNode, used: Uses): Md.List {
  const ordered = node.type === "orderedList";
  // Lists that must be loose to keep their content apart are loosened
  // while serializing; see listHandler.
  const spread = node.attrs?.spread === true;
  const items = (node.content ?? []).map((item): Md.ListItem => {
    const checked = item.attrs?.checked;
    return {
      type: "listItem",
      spread,
      checked: typeof checked === "boolean" ? checked : null,
      children: blocks(item.content ?? [], used) as Md.BlockContent[],
    };
  });
  return {
    type: "list",
    ordered,
    start: ordered ? Number(node.attrs?.start ?? 1) : null,
    spread,
    children: items,
  };
}

/**
 * A paragraph of inline content, or nothing when it is empty or holds only
 * line breaks.
 */
function paragraph(content: PMNode[], used: Uses): Md.Paragraph | null {
  if (content.every((n) => n.type === "hardBreak")) return null;
  const children = elementBreaks(inlines(content, used), used);
  if (!children.length) return null;
  return { type: "paragraph", children: children as Md.PhrasingContent[] };
}

/**
 * Rewrite as elements the hard breaks that Markdown's backslash and newline
 * cannot stand for:
 *
 * - at the end of the paragraph, where the backslash would be literal;
 * - before a line that would begin with a tag. MDX reads a line of only tags
 *   and expressions (`</u>`, `<Icon />`) as a block, which ends the
 *   paragraph, and Prettier's MDX parser does that for any line that begins
 *   with a tag.
 *
 * Every other break has text right after it and stays a Markdown hard break.
 */
function elementBreaks(nodes: AnyNode[], used: Uses): AnyNode[] {
  // Walking backwards: is the next thing written a tag (or the end of the
  // paragraph), and does any text follow at all?
  let tag = true;
  let text = false;
  const sawText = () => {
    tag = false;
    text = true;
  };
  const walk = (nodes: AnyNode[]): AnyNode[] => {
    const out = [...nodes];
    for (let i = out.length - 1; i >= 0; i--) out[i] = visit(out[i]);
    return out;
  };
  const visit = (node: AnyNode): AnyNode => {
    if (node.type === "break") {
      if (!tag && text) return node;
      tag = true;
      return htmlBreak(used);
    }
    if (node.type === "text") {
      // Whitespace alone doesn't make the line text.
      if (/\S/.test(node.value)) sawText();
      return node;
    }
    if (node.type === "mdxTextExpression") {
      tag = false;
      return node;
    }
    if (!("children" in node)) {
      sawText();
      return node;
    }
    // The closing and opening tags of an element, or the delimiters of
    // `**strong**` and `[a link](url)`.
    const edge = () =>
      node.type === "mdxJsxTextElement" ? (tag = true) : sawText();
    edge();
    const children = walk(node.children as AnyNode[]);
    edge();
    return { ...node, children } as AnyNode;
  };
  return walk(nodes);
}

/** A line break as an element: `<br />` in MDX, raw HTML in Markdown. */
function htmlBreak(used: Uses): AnyNode {
  return used.mdx
    ? { type: "mdxJsxTextElement", name: "br", attributes: [], children: [] }
    : { type: "html", value: "<br>" };
}

/**
 * Rewrite the hard breaks in a table cell or heading as elements. Both are
 * one line of Markdown, so the library would write a space instead, or turn
 * an h1/h2 into a setext heading.
 */
function htmlBreaks(nodes: AnyNode[], used: Uses): AnyNode[] {
  return nodes.map((node) => {
    if (node.type === "break") return htmlBreak(used);
    if (!("children" in node)) return node;
    const children = htmlBreaks(node.children as AnyNode[], used);
    return { ...node, children } as AnyNode;
  });
}

function footnoteLabel(node: PMNode): { identifier: string; label: string } {
  const label = String(node.attrs?.label ?? node.attrs?.identifier ?? "");
  const identifier = String(node.attrs?.identifier ?? label.toLowerCase());
  return { identifier, label };
}

function clampDepth(n: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return Math.min(6, Math.max(1, Math.round(n))) as 1 | 2 | 3 | 4 | 5 | 6;
}

function table(node: PMNode, used: Uses): Md.Table {
  const rows = node.content ?? [];
  const align: Md.AlignType[] = [];
  const children: Md.TableRow[] = rows.map((row, rowIdx) => ({
    type: "tableRow",
    children: (row.content ?? []).map((cell, colIdx) => {
      if (rowIdx === 0)
        align[colIdx] = (cell.attrs?.align as Md.AlignType) ?? null;
      const paragraphs = cell.content ?? [];
      const inline: PMNode[] = [];
      paragraphs.forEach((p, i) => {
        if (i > 0) inline.push({ type: "hardBreak" });
        inline.push(...(p.type === "paragraph" ? (p.content ?? []) : [p]));
      });
      return {
        type: "tableCell",
        children: htmlBreaks(
          inlines(inline, used),
          used,
        ) as Md.PhrasingContent[],
      };
    }),
  }));
  return { type: "table", align, children };
}

function propsToAttributes(
  node: PMNode,
  used: Uses,
  inline = false,
): (MdxJsxAttribute | MdxJsxExpressionAttribute)[] {
  const props = (node.attrs?.props ?? {}) as Record<string, unknown>;
  const spreads = (node.attrs?.spreads ?? []) as string[];
  const attrs: (MdxJsxAttribute | MdxJsxExpressionAttribute)[] = [];
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (value === true) {
      attrs.push({ type: "mdxJsxAttribute", name, value: null });
    } else if (isPlainString(value)) {
      attrs.push({ type: "mdxJsxAttribute", name, value });
    } else {
      // Block components print each attribute on its own line, indented
      // two spaces, so nested lines are indented relative to that.
      const source = valueToSource(value, inline ? "" : "  ");
      scan(source, used);
      attrs.push({
        type: "mdxJsxAttribute",
        name,
        value: { type: "mdxJsxAttributeValueExpression", value: source },
      });
    }
  }
  for (const s of spreads) {
    scan(s, used);
    attrs.push({ type: "mdxJsxExpressionAttribute", value: s });
  }
  return attrs;
}

function jsxElement(
  node: PMNode,
  used: Uses,
  inline: boolean,
): MdxJsxFlowElement | MdxJsxTextElement {
  const name = String(node.attrs?.name ?? "");
  if (name && /^[A-Z]/.test(name)) used.components.add(name);
  // `<ui.Card />` needs the import of `ui`.
  scan(name, used);
  const attributes = propsToAttributes(node, used, inline);
  if (inline) {
    return {
      type: "mdxJsxTextElement",
      name: name || null,
      attributes,
      children: inlines(node.content ?? [], used) as Md.PhrasingContent[],
    };
  }
  return {
    type: "mdxJsxFlowElement",
    name: name || null,
    attributes,
    children: blocks(node.content ?? [], used) as Md.BlockContent[],
  };
}

// ---------------------------------------------------------------- inlines

/**
 * Nesting order for marks that cover the same text, outermost first.
 * Superscript and subscript sit mid-word, where Markdown delimiters cannot
 * open (`x**<sup>2</sup>**`), so they go outside those. The other elements
 * go inside: a paragraph that begins `**<u>Note:</u>**` survives Prettier,
 * whose MDX parser takes one that begins with a tag for a JSX block.
 */
const MARK_ORDER = [
  "link",
  "superscript",
  "subscript",
  "bold",
  "italic",
  "strike",
  "textClass",
  "underline",
  "small",
  "code",
];

/** Marks written as an inline HTML element (JSX in MDX). */
const MARK_TAGS: Record<string, string> = {
  underline: "u",
  small: "small",
  superscript: "sup",
  subscript: "sub",
  textClass: "span",
};

/** Marks written with Markdown delimiters, which cannot start or end at a line break. */
const DELIMITER_MARKS = new Set(["bold", "italic", "strike"]);

/**
 * Convert a flat run of inline PM nodes (text with marks) into nested mdast
 * phrasing content. At each step the mark covering the longest run of
 * following nodes becomes the outer wrapper, so `**a <sup>6</sup> b**`
 * keeps bold outermost.
 */
function inlines(nodes: PMNode[], used: Uses): AnyNode[] {
  return group(nodes.map(breakMarks), used);
}

function markKey(m: PMMark): string {
  return JSON.stringify([m.type, m.attrs ?? {}]);
}

function hasMark(node: PMNode, key: string): boolean {
  return (node.marks ?? []).some((m) => markKey(m) === key);
}

function stripMark(node: PMNode, key: string): PMNode {
  return {
    ...node,
    marks: (node.marks ?? []).filter((m) => markKey(m) !== key),
  };
}

/**
 * The marks a hard break can be written with. Inline code holds no break,
 * and `**a\` + newline + `**` would not close the strong, so a break keeps a
 * delimiter mark only between marked content on both sides (the editor
 * leaves one at the edge when a selection that is made bold ends at a
 * break).
 */
function breakMarks(node: PMNode, index: number, nodes: PMNode[]): PMNode {
  if (node.type !== "hardBreak" || !node.marks?.length) return node;
  const inside = (key: string, step: 1 | -1) => {
    let i = index + step;
    while (nodes[i]?.type === "hardBreak" && hasMark(nodes[i], key)) i += step;
    return Boolean(nodes[i]) && hasMark(nodes[i], key);
  };
  const marks = node.marks.filter((m) => {
    if (m.type === "code") return false;
    if (!DELIMITER_MARKS.has(m.type)) return true;
    const key = markKey(m);
    return inside(key, -1) && inside(key, 1);
  });
  return marks.length === node.marks.length ? node : { ...node, marks };
}

function group(nodes: PMNode[], used: Uses): AnyNode[] {
  const out: AnyNode[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    const marks = node.marks ?? [];
    if (!marks.length) {
      out.push(...leaf(node, used));
      i++;
      continue;
    }
    // Pick the mark with the longest run from here.
    let best: PMMark | null = null;
    let bestLen = 0;
    for (const m of marks) {
      const key = markKey(m);
      let j = i;
      while (j < nodes.length && hasMark(nodes[j], key)) j++;
      const len = j - i;
      const better =
        len > bestLen ||
        (len === bestLen &&
          best !== null &&
          MARK_ORDER.indexOf(m.type) < MARK_ORDER.indexOf(best.type));
      if (better) {
        best = m;
        bestLen = len;
      }
    }
    const key = markKey(best!);
    const run = nodes.slice(i, i + bestLen).map((n) => stripMark(n, key));
    const children = group(run, used) as Md.PhrasingContent[];
    out.push(...wrap(best!, children, used));
    i += bestLen;
  }
  return joinTexts(out);
}

/**
 * Adjacent text nodes as one, as a parse reads them back: written apart,
 * mdast-util-to-markdown escapes each against an unknown neighbour (the
 * `(` after an escaped `]` too), so the file would not save back the same.
 */
function joinTexts(nodes: AnyNode[]): AnyNode[] {
  const out: AnyNode[] = [];
  for (const node of nodes) {
    const last = out.at(-1);
    if (node.type === "text" && last?.type === "text")
      out[out.length - 1] = {
        ...last,
        value: last.value + node.value,
      };
    else out.push(node);
  }
  return out;
}

function wrap(
  mark: PMMark,
  children: Md.PhrasingContent[],
  used: Uses,
): AnyNode[] {
  switch (mark.type) {
    case "bold":
      return [{ type: "strong", children }];
    case "italic":
      return [{ type: "emphasis", children }];
    case "strike":
      return [{ type: "delete", children }];
    case "link":
      return [
        {
          type: "link",
          url: String(mark.attrs?.href ?? ""),
          title: (mark.attrs?.title as string | null) ?? null,
          children,
        },
      ];
    case "code": {
      const text = children.map((c) => ("value" in c ? c.value : "")).join("");
      return [{ type: "inlineCode", value: text }];
    }
    default: {
      // A mark this serializer doesn't know: keep the text.
      if (!Object.hasOwn(MARK_TAGS, mark.type)) return children;
      const name = MARK_TAGS[mark.type];
      const className =
        mark.type === "textClass" ? String(mark.attrs?.class ?? "") : null;
      if (used.mdx)
        return [
          {
            type: "mdxJsxTextElement",
            name,
            attributes:
              className === null
                ? []
                : [
                    {
                      type: "mdxJsxAttribute",
                      name: "class",
                      value: className,
                    },
                  ],
            children,
          },
        ];
      const attributes =
        className === null ? "" : ` class="${escapeAttribute(className)}"`;
      return [
        { type: "html", value: `<${name}${attributes}>` },
        ...children,
        { type: "html", value: `</${name}>` },
      ];
    }
  }
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function leaf(node: PMNode, used: Uses): AnyNode[] {
  const convert = Object.hasOwn(LEAVES, node.type)
    ? LEAVES[node.type]
    : undefined;
  if (convert) return convert(node, used);
  return node.content ? inlines(node.content, used) : [];
}

/** How each kind of inline node is written, by its type in the editor. */
const LEAVES: Record<string, (node: PMNode, used: Uses) => AnyNode[]> = {
  text: (node) => (node.text ? [{ type: "text", value: node.text }] : []),
  hardBreak: () => [{ type: "break" }],
  image: (node) => [
    {
      type: "image",
      url: String(node.attrs?.src ?? ""),
      alt: (node.attrs?.alt as string | null) ?? null,
      title: (node.attrs?.title as string | null) ?? null,
    },
  ],
  rawInlineHtml: (node) => [
    { type: "html", value: String(node.attrs?.value ?? "") },
  ],
  mdxInlineComponent: (node, used) => [jsxElement(node, used, true)],
  mdxInlineExpression: (node, used) => [
    { type: "mdxTextExpression", value: scanned(node, used) },
  ],
  footnoteReference: (node) => [
    { type: "footnoteReference", ...footnoteLabel(node) },
  ],
  mdxComponent: (node, used) => [jsxElement(node, used, true)],
};

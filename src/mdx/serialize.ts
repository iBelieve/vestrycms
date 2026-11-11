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

/** What the document references, to decide which imports to emit. */
interface Uses {
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
  const used: Uses = { components: new Set(), identifiers: new Set() };
  const root: Md.Root = {
    type: "root",
    children: blocks(doc.content ?? [], used) as Md.RootContent[],
  };

  const imports = isMdx ? importStatements(used, options) : [];
  if (imports.length) {
    root.children.unshift({
      type: "mdxjsEsm",
      value: imports.join("\n"),
    } as MdxjsEsm as unknown as Md.RootContent);
  }

  const mdx = mdxToMarkdown({ quote: '"' });
  const libFlow = findHandler(mdx as ExtensionLike, "mdxJsxFlowElement");
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
    const children = state.containerFlow(
      el as unknown as Parameters<State["containerFlow"]>[0],
      info,
    );
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
      [list, ...list.children].some((p) => needsBlankLine(p, state))
    ) {
      list.spread = true;
      for (const item of list.children) item.spread = true;
    }
    return lib(node, parent, state, info);
  };
}

/** Mirrors mdast-util-to-markdown's `between`: tight only if a join says 0. */
function needsBlankLine(parent: Md.List | Md.ListItem, state: State): boolean {
  const children = parent.children as Md.Nodes[];
  for (let i = 1; i < children.length; i++) {
    let index = state.join.length;
    let lines: number | undefined;
    while (index--) {
      const result = state.join[index](
        children[i - 1] as never,
        children[i] as never,
        parent as never,
        state,
      );
      if (result === true || result === 1) break;
      if (typeof result === "number" || result === false) {
        lines = result === false ? 1 : result;
        break;
      }
    }
    if (lines !== 0) return true;
  }
  return false;
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
  switch (node.type) {
    case "paragraph": {
      const children = inlines(node.content ?? [], used);
      if (!children.length) return null;
      return { type: "paragraph", children: children as Md.PhrasingContent[] };
    }
    case "heading":
      return {
        type: "heading",
        depth: clampDepth(Number(node.attrs?.level ?? 1)),
        children: inlines(node.content ?? [], used) as Md.PhrasingContent[],
      };
    case "horizontalRule":
      return { type: "thematicBreak" };
    case "blockquote":
      return {
        type: "blockquote",
        children: blocks(node.content ?? [], used) as Md.BlockContent[],
      };
    case "bulletList":
    case "orderedList": {
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
    case "codeBlock":
      return {
        type: "code",
        lang: (node.attrs?.language as string | null) ?? null,
        meta: (node.attrs?.meta as string | null) ?? null,
        value: (node.content ?? []).map((t) => t.text ?? "").join(""),
      };
    case "rawHtml":
      return { type: "html", value: String(node.attrs?.value ?? "") };
    case "table":
      return table(node, used);
    case "mdxComponent":
      return jsxElement(node, used, false) as MdxJsxFlowElement;
    case "footnoteDefinition":
      return {
        type: "footnoteDefinition",
        ...footnoteLabel(node),
        children: blocks(node.content ?? [], used) as Md.BlockContent[],
      };
    case "mdxExpression": {
      const value = String(node.attrs?.value ?? "");
      scan(value, used);
      return { type: "mdxFlowExpression", value };
    }
    case "mdxEsm": {
      const value = String(node.attrs?.value ?? "");
      scan(value, used);
      return { type: "mdxjsEsm", value };
    }
    case "image":
      return {
        type: "paragraph",
        children: inlines([node], used) as Md.PhrasingContent[],
      };
    default: {
      const children = inlines([node], used);
      return children.length
        ? { type: "paragraph", children: children as Md.PhrasingContent[] }
        : null;
    }
  }
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
        children: inlines(inline, used) as Md.PhrasingContent[],
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

type MarkKind =
  "bold" | "italic" | "strike" | "code" | "link" | "superscript" | "subscript";
const MARK_ORDER: MarkKind[] = [
  "link",
  "superscript",
  "subscript",
  "bold",
  "italic",
  "strike",
  "code",
];

/**
 * Convert a flat run of inline PM nodes (text with marks) into nested mdast
 * phrasing content. At each step the mark covering the longest run of
 * following nodes becomes the outer wrapper, so `**a <sup>6</sup> b**`
 * keeps bold outermost.
 */
function inlines(nodes: PMNode[], used: Uses): AnyNode[] {
  return group(nodes, used);
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
          MARK_ORDER.indexOf(m.type as MarkKind) <
            MARK_ORDER.indexOf(best.type as MarkKind));
      if (better) {
        best = m;
        bestLen = len;
      }
    }
    const key = markKey(best!);
    const run = nodes.slice(i, i + bestLen).map((n) => stripMark(n, key));
    const children = group(run, used) as Md.PhrasingContent[];
    out.push(wrap(best!, children));
    i += bestLen;
  }
  return out;
}

function wrap(mark: PMMark, children: Md.PhrasingContent[]): AnyNode {
  switch (mark.type) {
    case "bold":
      return { type: "strong", children };
    case "italic":
      return { type: "emphasis", children };
    case "strike":
      return { type: "delete", children };
    case "link":
      return {
        type: "link",
        url: String(mark.attrs?.href ?? ""),
        title: (mark.attrs?.title as string | null) ?? null,
        children,
      };
    case "superscript":
      return {
        type: "mdxJsxTextElement",
        name: "sup",
        attributes: [],
        children,
      };
    case "subscript":
      return {
        type: "mdxJsxTextElement",
        name: "sub",
        attributes: [],
        children,
      };
    case "code": {
      const text = children.map((c) => ("value" in c ? c.value : "")).join("");
      return { type: "inlineCode", value: text };
    }
    default:
      return { type: "paragraph", children } as never;
  }
}

function leaf(node: PMNode, used: Uses): AnyNode[] {
  switch (node.type) {
    case "text":
      return node.text ? [{ type: "text", value: node.text }] : [];
    case "hardBreak":
      return [{ type: "break" }];
    case "image":
      return [
        {
          type: "image",
          url: String(node.attrs?.src ?? ""),
          alt: (node.attrs?.alt as string | null) ?? null,
          title: (node.attrs?.title as string | null) ?? null,
        },
      ];
    case "rawInlineHtml":
      return [{ type: "html", value: String(node.attrs?.value ?? "") }];
    case "mdxInlineComponent":
      return [jsxElement(node, used, true)];
    case "mdxInlineExpression": {
      const value = String(node.attrs?.value ?? "");
      scan(value, used);
      return [{ type: "mdxTextExpression", value }];
    }
    case "footnoteReference":
      return [{ type: "footnoteReference", ...footnoteLabel(node) }];
    case "mdxComponent":
      return [jsxElement(node, used, true)];
    default:
      return node.content ? (inlines(node.content, used) as AnyNode[]) : [];
  }
}

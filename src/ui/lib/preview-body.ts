import GithubSlugger from "github-slugger";
import type { Element, ElementContent, Nodes as HastNodes, Root } from "hast";
import { toHtml } from "hast-util-to-html";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import {
  mdxFromMarkdown,
  type MdxJsxFlowElement,
  type MdxJsxTextElement,
} from "mdast-util-mdx";
import { toHast, type State } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";
import { mdxjs } from "micromark-extension-mdxjs";
import type * as ES from "estree";
import type { PreviewPart } from "../../core/preview.js";
import { estreeToValue } from "../../mdx/expressions.js";
import { isRawExpression } from "../../mdx/types.js";

/** A component found in the body, by its place in the list. */
interface Found {
  component: string;
  props: Record<string, unknown>;
  hasChildren: boolean;
}

/** Marks where a component goes in the HTML, around its children. */
const PART_TAG = "vestry-part";

/**
 * An entry's body as the preview route draws it: HTML for everything
 * Markdown makes, and each component (`<Name …>`) with its props and the
 * parts inside it, for the site to render. The HTML is what MDX compiles
 * the body to (GFM tables, footnotes and links to bare addresses, and ids
 * on headings, as Astro gives them); images are shown from `resolveImage`,
 * so new uploads appear before they are saved. Expressions and `import`s
 * are left out: they need the site's build to run.
 */
export function previewBody(
  body: string,
  {
    format,
    resolveImage,
  }: { format: "md" | "mdx"; resolveImage: (src: string) => string },
): PreviewPart[] {
  if (!body.trim()) return [];
  const isMdx = format === "mdx";
  const tree = fromMarkdown(body, {
    extensions: isMdx ? [mdxjs(), gfm()] : [gfm()],
    mdastExtensions: isMdx
      ? [mdxFromMarkdown(), gfmFromMarkdown()]
      : [gfmFromMarkdown()],
  });
  const found: Found[] = [];
  const jsx = (state: State, node: MdxJsxFlowElement | MdxJsxTextElement) =>
    jsxToHast(state, node, found);
  const hast = toHast(tree, {
    allowDangerousHtml: true,
    handlers: {
      mdxJsxFlowElement: jsx,
      mdxJsxTextElement: jsx,
      mdxFlowExpression: () => undefined,
      mdxTextExpression: () => undefined,
      mdxjsEsm: () => undefined,
    },
  }) as Root;
  finish(hast, resolveImage);
  return splitParts(toHtml(hast, { allowDangerousHtml: true }), found);
}

/** A JSX element: an HTML element as it is, or a component's placeholder. */
function jsxToHast(
  state: State,
  node: MdxJsxFlowElement | MdxJsxTextElement,
  found: Found[],
): ElementContent | ElementContent[] {
  const children = state.all(node);
  const name = node.name;
  // A fragment, `<>…</>`, is only its children.
  if (!name) return children;
  const props = attributes(node);
  if (isComponentName(name)) {
    found.push({
      component: name,
      props,
      hasChildren: node.children.length > 0,
    });
    return {
      type: "element",
      tagName: PART_TAG,
      properties: { dataPart: String(found.length - 1) },
      children,
    };
  }
  return {
    type: "element",
    tagName: name,
    properties: htmlProperties(props),
    children,
  };
}

/** MDX's rule: a capitalized or dotted name is a component, anything else an HTML tag. */
const isComponentName = (name: string) =>
  /^[A-Z]/.test(name) || name.includes(".");

/** An element's attributes as props: literal values only, as MDX would pass them. */
function attributes(
  node: MdxJsxFlowElement | MdxJsxTextElement,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const attr of node.attributes) {
    // `{...spread}` needs the site's code to evaluate.
    if (attr.type !== "mdxJsxAttribute") continue;
    const value = attr.value;
    if (value === null || value === undefined) props[attr.name] = true;
    else if (typeof value === "string") props[attr.name] = value;
    else {
      const literal = estreeToValue(
        value.data?.estree as ES.Program | undefined,
        value.value,
      );
      if (!isRawExpression(literal)) props[attr.name] = literal;
    }
  }
  return props;
}

/** An HTML element's attributes for hast: text, numbers and true, `class` as a list. */
function htmlProperties(
  props: Record<string, unknown>,
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(props)) {
    const name = key === "className" ? "class" : key;
    if (name === "class" && typeof value === "string")
      out.className = value.split(/\s+/).filter(Boolean);
    else if (["string", "number", "boolean"].includes(typeof value))
      out[name] = value as string | number | boolean;
  }
  return out;
}

const HEADING = /^h[1-6]$/;

/** Ids on headings, as Astro adds them, and images shown from where the editor has them. */
function finish(tree: Root, resolveImage: (src: string) => string) {
  const slugger = new GithubSlugger();
  const visit = (node: HastNodes) => {
    if (node.type === "element") {
      if (HEADING.test(node.tagName) && node.properties.id === undefined)
        node.properties.id = slugger.slug(textOf(node));
      if (node.tagName === "img" && typeof node.properties.src === "string")
        node.properties.src = resolveImage(node.properties.src);
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(tree);
}

function textOf(node: Element | ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textOf).join("");
  return "";
}

const PART_PATTERN = new RegExp(
  `<${PART_TAG} data-part="(\\d+)">|</${PART_TAG}>`,
  "g",
);

/** The HTML cut at the components' placeholders, nested as they are. */
function splitParts(html: string, found: Found[]): PreviewPart[] {
  const root: PreviewPart[] = [];
  if (!found.length) return html ? [html] : root;
  const stack: PreviewPart[][] = [root];
  let last = 0;
  for (const match of html.matchAll(PART_PATTERN)) {
    const top = stack[stack.length - 1];
    if (match.index > last) top.push(html.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[1] === undefined) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const { component, props, hasChildren } = found[Number(match[1])];
    const children: PreviewPart[] = [];
    top.push({ component, props, children: hasChildren ? children : null });
    stack.push(children);
  }
  if (last < html.length) root.push(html.slice(last));
  return root;
}

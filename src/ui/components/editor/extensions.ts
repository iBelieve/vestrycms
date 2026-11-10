import { Node, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import {
  ComponentNodeView,
  InlineComponentNodeView,
  RawBlockNodeView,
} from "./NodeViews.js";

/** A block-level MDX component, e.g. `<Highlights items={[...]} />`. */
export const MdxComponent = Node.create({
  name: "mdxComponent",
  group: "block",
  content: "block*",
  defining: true,
  isolating: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      name: { default: "" },
      props: { default: {} },
      spreads: { default: [] },
      hasChildren: { default: false },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-mdx-component]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-mdx-component": node.attrs.name,
      }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ComponentNodeView, {
      contentDOMElementTag: "div",
    });
  },
});

/** An inline MDX component, e.g. `<Abbr title="...">WELS</Abbr>`. */
export const MdxInlineComponent = Node.create({
  name: "mdxInlineComponent",
  group: "inline",
  inline: true,
  content: "inline*",
  selectable: true,
  addAttributes() {
    return {
      name: { default: "" },
      props: { default: {} },
      spreads: { default: [] },
      hasChildren: { default: false },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-mdx-inline-component]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-mdx-inline-component": node.attrs.name,
        class: "v-inline-component",
        "data-name": node.attrs.name,
      }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(InlineComponentNodeView, {
      contentDOMElementTag: "span",
    });
  },
});

function rawBlock(name: string, kind: "expression" | "esm" | "html") {
  return Node.create({
    name,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes() {
      return { value: { default: "" }, kind: { default: kind } };
    },
    parseHTML() {
      return [{ tag: `div[data-${name}]` }];
    },
    renderHTML({ HTMLAttributes, node }) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, { [`data-${name}`]: "" }),
        node.attrs.value,
      ];
    },
    addNodeView() {
      return ReactNodeViewRenderer(RawBlockNodeView);
    },
  });
}

/** `{expression}` at block level. */
export const MdxExpression = rawBlock("mdxExpression", "expression");
/** `export const x = ...` and other ESM that isn't a known import. */
export const MdxEsm = rawBlock("mdxEsm", "esm");
/** Raw HTML blocks (plain Markdown files). */
export const RawHtml = rawBlock("rawHtml", "html");

function rawInline(name: string) {
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return { value: { default: "" } };
    },
    parseHTML() {
      return [{ tag: `span[data-${name}]` }];
    },
    renderHTML({ HTMLAttributes, node }) {
      return [
        "span",
        mergeAttributes(HTMLAttributes, {
          [`data-${name}`]: "",
          class: "v-inline-expression",
          title: "Click to edit",
        }),
        name === "mdxInlineExpression"
          ? `{${node.attrs.value}}`
          : node.attrs.value,
      ];
    },
  });
}

export const MdxInlineExpression = rawInline("mdxInlineExpression");
export const RawInlineHtml = rawInline("rawInlineHtml");

/**
 * Markdown images are inline. `resolveSrc` maps the stored path (relative to
 * the entry file, or a public URL) to something the browser can load.
 */
export const MdxImage = Image.extend<
  { resolveSrc: (src: string) => string } & Record<string, unknown>
>({
  addOptions() {
    return {
      ...this.parent?.(),
      inline: true,
      allowBase64: false,
      resolveSrc: (src: string) => src,
    };
  },
  renderHTML({ HTMLAttributes }) {
    const src = String(HTMLAttributes.src ?? "");
    return [
      "img",
      mergeAttributes(
        this.options.HTMLAttributes as Record<string, unknown>,
        HTMLAttributes,
        { src: this.options.resolveSrc(src), "data-src": src },
      ),
    ];
  },
});

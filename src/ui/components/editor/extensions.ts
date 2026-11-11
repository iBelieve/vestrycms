import { Extension, Node, mergeAttributes } from "@tiptap/core";
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

/**
 * List attributes from Markdown that StarterKit's lists lack: whether a list
 * is loose (blank lines between items; tightening it changes the rendered
 * HTML) and a task item's checkbox (`- [ ]` / `- [x]`).
 */
export const ListAttributes = Extension.create({
  name: "listAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ["bulletList", "orderedList"],
        attributes: {
          spread: {
            default: false,
            parseHTML: (el) => el.hasAttribute("data-spread"),
            renderHTML: (attrs) => (attrs.spread ? { "data-spread": "" } : {}),
          },
        },
      },
      {
        types: ["listItem"],
        attributes: {
          checked: {
            default: null,
            parseHTML: (el) => {
              const v = el.getAttribute("data-checked");
              return v === null ? null : v === "true";
            },
            renderHTML: (attrs) =>
              typeof attrs.checked === "boolean"
                ? { "data-checked": String(attrs.checked) }
                : {},
          },
        },
      },
    ];
  },
});

const footnoteAttributes = {
  identifier: { default: "" },
  label: { default: "" },
};

/** A GFM footnote definition, `[^label]: ...`. */
export const FootnoteDefinition = Node.create({
  name: "footnoteDefinition",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return footnoteAttributes;
  },
  parseHTML() {
    return [{ tag: "div[data-footnote-definition]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-footnote-definition": "",
        "data-label": `[^${node.attrs.label}]`,
        class: "v-footnote-definition",
      }),
      0,
    ];
  },
});

/** A GFM footnote reference, `[^label]`. */
export const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return footnoteAttributes;
  },
  parseHTML() {
    // Ahead of Superscript's `sup` rule, or a pasted reference turns into
    // superscript text.
    return [{ tag: "sup[data-footnote-reference]", priority: 60 }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "sup",
      mergeAttributes(HTMLAttributes, {
        "data-footnote-reference": "",
        class: "v-footnote-reference",
      }),
      `[^${node.attrs.label}]`,
    ];
  },
});

import {
  Extension,
  Mark,
  Node,
  isMarkActive,
  mergeAttributes,
} from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { TextStyleConfig } from "../../../config/types.js";
import {
  ComponentNodeView,
  InlineComponentNodeView,
  RawBlockNodeView,
} from "./NodeViews.js";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    small: {
      /** Toggle `<small>` on the selection. */
      toggleSmall: () => ReturnType;
    };
    hardBreakMarks: {
      /** Insert a hard break that carries the marks at the cursor. */
      setMarkedHardBreak: () => ReturnType;
    };
    textClass: {
      /** Toggle a `<span>` with this class on the selection, leaving other classes in place. */
      toggleTextClass: (className: string) => ReturnType;
    };
  }
}

/** Small print, `<small>…</small>`. */
export const Small = Mark.create({
  name: "small",
  parseHTML() {
    return [{ tag: "small" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["small", HTMLAttributes, 0];
  },
  addCommands() {
    return {
      toggleSmall:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
});

/**
 * Text in a `<span class="…">`. The class is whatever the document says;
 * `styles` (the site's `textStyles`) only decides how it looks here. Named
 * `textClass` to stay clear of `@tiptap/extension-text-style`'s `textStyle`.
 *
 * Spans nest, so one piece of text can carry several of these marks, and
 * the class is kept in a data attribute: as a real class it could pick up
 * the control panel's own CSS.
 */
export const TextClass = Mark.create<{
  styles: Record<string, TextStyleConfig>;
}>({
  name: "textClass",
  excludes: "",
  addOptions() {
    return { styles: {} };
  },
  addAttributes() {
    return {
      class: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-text-class") ?? "",
        renderHTML: (attrs) => ({ "data-text-class": String(attrs.class) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-text-class]" }];
  },
  renderHTML({ HTMLAttributes, mark }) {
    const className = String(mark.attrs.class);
    const style = Object.values(this.options.styles).find(
      (s) => s.class === className,
    );
    return [
      "span",
      mergeAttributes(
        HTMLAttributes,
        { title: style?.label ?? `class="${className}"` },
        // Without a preview (or for a class the config doesn't list) an
        // outline shows where the span is.
        style?.css ? { style: style.css } : { class: "v-text-class" },
      ),
      0,
    ];
  },
  addCommands() {
    return {
      toggleTextClass:
        (className) =>
        ({ state, tr, dispatch }) => {
          const mark = this.type.create({ class: className });
          const active = isMarkActive(state, this.type, { class: className });
          if (!dispatch) return true;
          const { empty, ranges } = state.selection;
          if (empty) {
            if (active) tr.removeStoredMark(mark);
            else tr.addStoredMark(mark);
          } else {
            for (const { $from, $to } of ranges) {
              if (active) tr.removeMark($from.pos, $to.pos, mark);
              else tr.addMark($from.pos, $to.pos, mark);
            }
          }
          return true;
        },
    };
  },
});

/**
 * A line break typed inside marked text takes the marks at the cursor, as
 * text typed there would. StarterKit's hard break is inserted bare, which
 * splits the mark in two: `<u>one</u><br /><u>two</u>` rather than a single
 * `<u>` holding the break.
 */
export const HardBreakMarks = Extension.create({
  name: "hardBreakMarks",
  // Ahead of the hard break's own shortcuts.
  priority: 200,
  addCommands() {
    return {
      setMarkedHardBreak:
        () =>
        ({ state, chain }) => {
          // Inline code cannot hold a break.
          const marks = (
            state.storedMarks ?? state.selection.$from.marks()
          ).filter((m) => m.type.name !== "code");
          return chain()
            .setHardBreak()
            .command(({ tr }) => {
              const pos = tr.selection.from - 1;
              const inserted = pos >= 0 ? tr.doc.nodeAt(pos) : null;
              if (!marks.length || inserted?.type.name !== "hardBreak")
                return true;
              // Changing the document drops the marks kept for the text
              // typed next.
              const stored = tr.storedMarks;
              tr.setNodeMarkup(pos, undefined, undefined, marks);
              if (stored) tr.ensureMarks(stored);
              return true;
            })
            .run();
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => this.editor.commands.setMarkedHardBreak(),
      "Shift-Enter": () => this.editor.commands.setMarkedHardBreak(),
    };
  },
});

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

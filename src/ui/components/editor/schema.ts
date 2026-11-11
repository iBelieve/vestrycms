import { TableKit } from "@tiptap/extension-table";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import {
  FootnoteDefinition,
  FootnoteReference,
  ListAttributes,
  MdxComponent,
  MdxEsm,
  MdxExpression,
  MdxImage,
  MdxInlineComponent,
  MdxInlineExpression,
  RawHtml,
  RawInlineHtml,
} from "./extensions.js";

export interface EditorExtensionOptions {
  /** Maps a stored image path to a URL the browser can load. */
  resolveSrc?: (src: string) => string;
  placeholder?: string;
}

/**
 * The rich text editor's extensions. Its schema must accept every node type
 * and attribute `parseMdx` produces, or they are lost when a page is saved.
 */
export function editorExtensions(options: EditorExtensionOptions = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      codeBlock: { languageClassPrefix: "language-" },
      dropcursor: { color: "var(--v-primary)", width: 2 },
    }),
    Superscript,
    Subscript,
    MdxImage.configure({ resolveSrc: options.resolveSrc ?? ((src) => src) }),
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({
      placeholder: options.placeholder ?? "Start writing…",
    }),
    MdxComponent,
    MdxInlineComponent,
    MdxExpression,
    MdxInlineExpression,
    MdxEsm,
    RawHtml,
    RawInlineHtml,
    ListAttributes,
    FootnoteDefinition,
    FootnoteReference,
  ];
}

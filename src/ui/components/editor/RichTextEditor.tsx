import { TableKit } from "@tiptap/extension-table";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Placeholder } from "@tiptap/extensions";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Code2,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Subscript as SubIcon,
  Superscript as SupIcon,
  Table as TableIcon,
  Undo2,
  Unlink,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseMdx, serializeMdx } from "../../../mdx/index.js";
import type {
  ComponentRegistry,
  ImportSpec,
  PMNode,
} from "../../../mdx/types.js";
import { cx, defaultValues } from "../../lib/utils.js";
import { AssetPicker } from "../AssetPicker.js";
import { Icon } from "../Icon.js";
import { CodeInput } from "../fields/CodeInput.js";
import { Button, Menu, Modal } from "../ui.js";
import {
  EditorEnvContext,
  useEditorEnv,
  type EditorEnv,
} from "./EditorContext.js";
import {
  MdxComponent,
  MdxEsm,
  MdxExpression,
  MdxImage,
  MdxInlineComponent,
  MdxInlineExpression,
  RawHtml,
  RawInlineHtml,
} from "./extensions.js";

export interface RichTextEditorProps {
  value: string;
  onChange: (mdx: string) => void;
  /** Component names allowed in this document. */
  components?: string[];
  env: EditorEnv;
  format?: "md" | "mdx";
  placeholder?: string;
  compact?: boolean;
  /** Render without its own border, to sit flush inside a card. */
  flush?: boolean;
  onUpload?: (upload: {
    path: string;
    base64: string;
    previewUrl: string;
  }) => void;
}

/**
 * Tiptap editor that reads and writes MDX. The document is parsed once on
 * load; edits are serialized back (debounced) and reported through `onChange`.
 * A source mode exposes the raw MDX in CodeMirror; switching back re-parses.
 */
export function RichTextEditor(props: RichTextEditorProps) {
  return (
    <EditorEnvContext.Provider value={props.env}>
      <EditorInner {...props} />
    </EditorEnvContext.Provider>
  );
}

function EditorInner({
  value,
  onChange,
  components,
  env,
  format = "mdx",
  placeholder,
  compact,
  flush,
  onUpload,
}: RichTextEditorProps) {
  const [mode, setMode] = useState<"visual" | "source">("visual");
  const [parseError, setParseError] = useState<string | null>(null);
  const importsRef = useRef<Record<string, ImportSpec>>({});
  const lastEmitted = useRef(value);
  const registry = useMemo<ComponentRegistry>(() => {
    const out: ComponentRegistry = {};
    for (const [name, c] of Object.entries(env.components)) {
      out[name] = {
        import: c.import,
        namedImport: c.namedImport,
        inline: c.inline,
        children: c.children,
      };
    }
    return out;
  }, [env.components]);

  const parse = useCallback(
    (mdx: string): PMNode | null => {
      try {
        const parsed = parseMdx(mdx, { format });
        importsRef.current = parsed.imports;
        setParseError(null);
        return parsed.doc;
      } catch (e) {
        setParseError((e as Error).message);
        return null;
      }
    },
    [format],
  );

  const serialize = useCallback(
    (doc: PMNode) =>
      serializeMdx(doc, {
        format,
        components: registry,
        existingImports: importsRef.current,
      }),
    [format, registry],
  );

  const initialDoc = useMemo(() => parse(value), []); // eslint-disable-line react-hooks/exhaustive-deps

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
        codeBlock: { languageClassPrefix: "language-" },
        dropcursor: { color: "var(--v-primary)", width: 2 },
      }),
      Superscript,
      Subscript,
      MdxImage.configure({
        resolveSrc: (src: string) => env.resolveImage?.(src) ?? src,
      }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: placeholder ?? "Start writing…" }),
      MdxComponent,
      MdxInlineComponent,
      MdxExpression,
      MdxInlineExpression,
      MdxEsm,
      RawHtml,
      RawInlineHtml,
    ],
    [env, placeholder],
  );

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useEditor({
    extensions,
    content: initialDoc ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: { attributes: { class: "v-prose", spellcheck: "true" } },
    onUpdate: ({ editor }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const mdx = serialize(editor.getJSON() as PMNode);
        lastEmitted.current = mdx;
        onChange(mdx);
      }, 250);
    },
  });

  // External value changes (e.g. after a reload) → re-parse.
  useEffect(() => {
    if (!editor || mode !== "visual") return;
    if (value === lastEmitted.current) return;
    const doc = parse(value);
    if (doc) {
      lastEmitted.current = value;
      editor.commands.setContent(doc, { emitUpdate: false });
    }
  }, [value, editor, mode, parse]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const switchMode = (next: "visual" | "source") => {
    if (next === mode || !editor) return;
    if (next === "source") {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        const mdx = serialize(editor.getJSON() as PMNode);
        lastEmitted.current = mdx;
        onChange(mdx);
      }
      setMode("source");
    } else {
      const doc = parse(value);
      if (!doc) return;
      lastEmitted.current = value;
      editor.commands.setContent(doc, { emitUpdate: false });
      setMode("visual");
    }
  };

  return (
    <div
      className={cx(
        "v-rte",
        compact && "v-rte--compact",
        flush && "v-rte--flush",
      )}
    >
      {editor && (
        <Toolbar
          editor={editor}
          mode={mode}
          onMode={switchMode}
          components={components ?? Object.keys(env.components)}
          onUpload={onUpload}
          format={format}
        />
      )}
      {mode === "visual" ? (
        <EditorContent editor={editor} />
      ) : (
        <div className="v-source-editor">
          {parseError && (
            <div className="v-alert v-alert--error" style={{ margin: 10 }}>
              Could not parse MDX: {parseError}
            </div>
          )}
          <CodeInput
            value={value}
            language="markdown"
            minHeight="320px"
            onChange={(v) => {
              lastEmitted.current = v;
              onChange(v);
            }}
          />
        </div>
      )}
    </div>
  );
}

function Toolbar({
  editor,
  mode,
  onMode,
  components,
  onUpload,
  format,
}: {
  editor: Editor;
  mode: "visual" | "source";
  onMode: (m: "visual" | "source") => void;
  components: string[];
  onUpload?: RichTextEditorProps["onUpload"];
  format: "md" | "mdx";
}) {
  const env = useEditorEnv();
  const [linkOpen, setLinkOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      sup: editor.isActive("superscript"),
      sub: editor.isActive("subscript"),
      link: editor.isActive("link"),
      h1: editor.isActive("heading", { level: 1 }),
      h2: editor.isActive("heading", { level: 2 }),
      h3: editor.isActive("heading", { level: 3 }),
      bullet: editor.isActive("bulletList"),
      ordered: editor.isActive("orderedList"),
      quote: editor.isActive("blockquote"),
      codeBlock: editor.isActive("codeBlock"),
      table: editor.isActive("table"),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  });
  const disabled = mode === "source";

  const tool = (
    label: string,
    active: boolean | undefined,
    icon: React.ReactNode,
    run: () => void,
    isDisabled = false,
  ) => (
    <button
      type="button"
      className={cx("v-rte__tool", active && "is-active")}
      title={label}
      aria-label={label}
      disabled={disabled || isDisabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );

  const insertComponent = (name: string) => {
    const cfg = env.components[name];
    const props = defaultValues(cfg?.props ?? {});
    if (cfg?.inline) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "mdxInlineComponent",
          attrs: { name, props, hasChildren: Boolean(cfg.children) },
          content: cfg.children ? [{ type: "text", text: "text" }] : [],
        })
        .run();
      return;
    }
    const node: PMNode = {
      type: "mdxComponent",
      attrs: { name, props, hasChildren: Boolean(cfg?.children) },
      content: cfg?.children ? [{ type: "paragraph" }] : [],
    };
    editor.chain().focus().insertContent(node).run();
  };

  return (
    <div className="v-rte__toolbar">
      {tool(
        "Undo",
        false,
        <Undo2 />,
        () => editor.chain().focus().undo().run(),
        !state.canUndo,
      )}
      {tool(
        "Redo",
        false,
        <Redo2 />,
        () => editor.chain().focus().redo().run(),
        !state.canRedo,
      )}
      <span className="v-rte__sep" />
      {tool("Heading 1", state.h1, <Heading1 />, () =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
      )}
      {tool("Heading 2", state.h2, <Heading2 />, () =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
      )}
      {tool("Heading 3", state.h3, <Heading3 />, () =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
      )}
      <span className="v-rte__sep" />
      {tool("Bold", state.bold, <Bold />, () =>
        editor.chain().focus().toggleBold().run(),
      )}
      {tool("Italic", state.italic, <Italic />, () =>
        editor.chain().focus().toggleItalic().run(),
      )}
      {tool("Strikethrough", state.strike, <Strikethrough />, () =>
        editor.chain().focus().toggleStrike().run(),
      )}
      {tool("Inline code", state.code, <Code />, () =>
        editor.chain().focus().toggleCode().run(),
      )}
      {format === "mdx" &&
        tool("Superscript", state.sup, <SupIcon />, () =>
          editor.chain().focus().toggleSuperscript().run(),
        )}
      {format === "mdx" &&
        tool("Subscript", state.sub, <SubIcon />, () =>
          editor.chain().focus().toggleSubscript().run(),
        )}
      {state.link
        ? tool("Remove link", true, <Unlink />, () =>
            editor.chain().focus().unsetLink().run(),
          )
        : tool("Link", false, <LinkIcon />, () => setLinkOpen(true))}
      <span className="v-rte__sep" />
      {tool("Bullet list", state.bullet, <List />, () =>
        editor.chain().focus().toggleBulletList().run(),
      )}
      {tool("Numbered list", state.ordered, <ListOrdered />, () =>
        editor.chain().focus().toggleOrderedList().run(),
      )}
      {tool("Quote", state.quote, <Quote />, () =>
        editor.chain().focus().toggleBlockquote().run(),
      )}
      {tool("Code block", state.codeBlock, <Code2 />, () =>
        editor.chain().focus().toggleCodeBlock().run(),
      )}
      {tool("Divider", false, <Minus />, () =>
        editor.chain().focus().setHorizontalRule().run(),
      )}
      {tool(
        "Image",
        false,
        <ImageIcon />,
        () => setImageOpen(true),
        !env.imageDirectory,
      )}
      <Menu
        trigger={({ toggle }) => (
          <button
            type="button"
            className={cx("v-rte__tool", state.table && "is-active")}
            title="Table"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggle}
          >
            <TableIcon />
          </button>
        )}
      >
        {(close) => (
          <>
            <button
              className="v-menu__item"
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run();
                close();
              }}
            >
              Insert table
            </button>
            {state.table && (
              <>
                <button
                  className="v-menu__item"
                  onClick={() => {
                    editor.chain().focus().addRowAfter().run();
                    close();
                  }}
                >
                  Add row below
                </button>
                <button
                  className="v-menu__item"
                  onClick={() => {
                    editor.chain().focus().addColumnAfter().run();
                    close();
                  }}
                >
                  Add column after
                </button>
                <button
                  className="v-menu__item"
                  onClick={() => {
                    editor.chain().focus().deleteRow().run();
                    close();
                  }}
                >
                  Delete row
                </button>
                <button
                  className="v-menu__item"
                  onClick={() => {
                    editor.chain().focus().deleteColumn().run();
                    close();
                  }}
                >
                  Delete column
                </button>
                <button
                  className="v-menu__item is-danger"
                  onClick={() => {
                    editor.chain().focus().deleteTable().run();
                    close();
                  }}
                >
                  Delete table
                </button>
              </>
            )}
          </>
        )}
      </Menu>
      {format === "mdx" && components.length > 0 && (
        <>
          <span className="v-rte__sep" />
          <Menu
            trigger={({ toggle }) => (
              <button
                type="button"
                className="v-rte__insert"
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggle}
              >
                <Plus /> Insert
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="v-menu__heading">Components</div>
                {components.map((name) => {
                  const c = env.components[name];
                  return (
                    <button
                      key={name}
                      className="v-menu__item"
                      onClick={() => {
                        insertComponent(name);
                        close();
                      }}
                    >
                      <Icon name={c?.icon ?? "box"} />
                      <span>
                        {c?.label ?? name}
                        {c?.description && <small>{c.description}</small>}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </Menu>
        </>
      )}
      <span className="v-rte__spacer" />
      <div className="v-segment" style={{ height: 30 }}>
        <button
          type="button"
          className={cx(mode === "visual" && "is-active")}
          style={{ height: 28 }}
          onClick={() => onMode("visual")}
          title="Visual editor"
        >
          <Eye size={14} style={{ marginRight: 4, verticalAlign: -2 }} /> Visual
        </button>
        <button
          type="button"
          className={cx(mode === "source" && "is-active")}
          style={{ height: 28 }}
          onClick={() => onMode("source")}
          title="Edit MDX source"
        >
          <Code2 size={14} style={{ marginRight: 4, verticalAlign: -2 }} />{" "}
          Source
        </button>
      </div>
      {linkOpen && (
        <LinkDialog editor={editor} onClose={() => setLinkOpen(false)} />
      )}
      {imageOpen && env.imageDirectory && (
        <AssetPicker
          directory={env.imageDirectory}
          accept={["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"]}
          title="Insert image"
          deferUploads={Boolean(onUpload)}
          onClose={() => setImageOpen(false)}
          onPick={(path, upload) => {
            if (upload) onUpload?.(upload);
            editor
              .chain()
              .focus()
              .setImage({ src: env.toDocPath(path), alt: "" })
              .run();
            setImageOpen(false);
          }}
        />
      )}
    </div>
  );
}

function LinkDialog({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [href, setHref] = useState<string>(
    () => (editor.getAttributes("link").href as string) ?? "",
  );
  const apply = () => {
    const url = href.trim();
    if (!url) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    onClose();
  };
  return (
    <Modal
      title="Link"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <label className="v-field__label" htmlFor="v-link-url">
        URL
      </label>
      <input
        id="v-link-url"
        className="v-input"
        autoFocus
        value={href}
        placeholder="https://example.com or /visit"
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
      />
    </Modal>
  );
}

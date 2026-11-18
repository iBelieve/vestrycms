import {
  EditorContent,
  useEditor,
  useEditorState,
  type ChainedCommands,
  type Editor,
} from "@tiptap/react";
import {
  ALargeSmall,
  Check,
  ChevronDown,
  Code,
  CodeXml,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  LetterB,
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
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { parseMdx, serializeMdx } from "../../../mdx/index.js";
import type {
  ComponentConfig,
  TextStyleConfig,
} from "../../../config/types.js";
import type {
  ComponentRegistry,
  ImportSpec,
  PMNode,
} from "../../../mdx/types.js";
import {
  cssToStyle,
  cx,
  defaultValues,
  IMAGE_EXTENSIONS,
} from "../../lib/utils.js";
import { AssetPicker } from "../AssetPicker.js";
import { Icon } from "../Icon.js";
import { CodeInput } from "../fields/CodeInput.js";
import { Button, Menu, Modal } from "../ui.js";
import {
  EditorEnvContext,
  useEditorEnv,
  type EditorEnv,
} from "./EditorContext.js";
import { editorExtensions } from "./schema.js";

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

function EditorInner(props: RichTextEditorProps) {
  const { value, format = "mdx", components, env } = props;
  const [mode, setMode] = useState<"visual" | "source">("visual");
  const mdx = useMdxEditor(props, mode === "visual");
  const { editor } = mdx;

  const switchMode = (next: "visual" | "source") => {
    if (next === mode || !editor) return;
    if (next === "source") {
      mdx.flush();
      setMode("source");
    } else if (mdx.load(editor, value)) {
      setMode("visual");
    }
  };

  return (
    <div
      className={cx(
        "v-rte",
        props.compact && "v-rte--compact",
        props.flush && "v-rte--flush",
      )}
    >
      {editor && (
        <Toolbar
          editor={editor}
          mode={mode}
          onMode={switchMode}
          components={components ?? Object.keys(env.components)}
          onUpload={props.onUpload}
          format={format}
        />
      )}
      {mode === "visual" ? (
        <EditorContent editor={editor} />
      ) : (
        <div className="v-source-editor">
          {mdx.parseError && (
            <div className="v-alert v-alert--error" style={{ margin: 10 }}>
              Could not parse MDX: {mdx.parseError}
            </div>
          )}
          <CodeInput
            value={value}
            language="markdown"
            minHeight="320px"
            onChange={mdx.emit}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The Tiptap editor over `value`: edits are reported (debounced) through
 * `onChange`, and while `visual` a new `value` from outside is loaded.
 */
function useMdxEditor(
  {
    value,
    onChange,
    env,
    format = "mdx",
    placeholder,
  }: Pick<
    RichTextEditorProps,
    "value" | "onChange" | "env" | "format" | "placeholder"
  >,
  visual: boolean,
) {
  const { parse, serialize, parseError } = useMdxCodec(format, env.components);
  const out = useEmitter(onChange, value);
  const initialDoc = useMemo(() => parse(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const extensions = useMemo(
    () =>
      editorExtensions({
        resolveSrc: (src) => env.resolveImage?.(src) ?? src,
        placeholder,
        textStyles: env.textStyles,
      }),
    [env, placeholder],
  );
  const editor = useEditor({
    extensions,
    content: initialDoc ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: { attributes: { class: "v-prose", spellcheck: "true" } },
    onUpdate: ({ editor }) =>
      out.schedule(() => serialize(editor.getJSON() as PMNode)),
  });

  /** Shows `mdx` in the visual editor; false when it does not parse. */
  const load = (editor: Editor, mdx: string) => {
    const doc = parse(mdx);
    if (!doc) return false;
    out.last.current = mdx;
    editor.commands.setContent(doc, { emitUpdate: false });
    return true;
  };

  // External value changes (e.g. after a reload) → re-parse.
  useEffect(() => {
    if (editor && visual && value !== out.last.current) load(editor, value);
  }, [value, editor, visual, parse]); // eslint-disable-line react-hooks/exhaustive-deps

  return { editor, parseError, load, emit: out.emit, flush: out.flush };
}

/**
 * Parses MDX into an editor document, remembering its imports and the last
 * parse error, and serializes a document back with those imports.
 */
function useMdxCodec(
  format: "md" | "mdx",
  components: Record<string, ComponentConfig>,
) {
  const [parseError, setParseError] = useState<string | null>(null);
  const importsRef = useRef<Record<string, ImportSpec>>({});
  const registry = useMemo<ComponentRegistry>(() => {
    const out: ComponentRegistry = {};
    for (const [name, c] of Object.entries(components)) {
      out[name] = {
        import: c.import,
        namedImport: c.namedImport,
        inline: c.inline,
        children: c.children,
      };
    }
    return out;
  }, [components]);

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

  return { parse, serialize, parseError };
}

/**
 * Reports MDX through `onChange`, remembering the last value reported so an
 * echo of it isn't loaded again. `schedule` reports edits after a 250 ms
 * pause; `flush` reports a scheduled one at once.
 */
function useEmitter(onChange: (mdx: string) => void, initial: string) {
  const last = useRef(initial);
  const pending = useRef<{
    timer: ReturnType<typeof setTimeout>;
    read: () => string;
  } | null>(null);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer);
    },
    [],
  );
  const emit = (mdx: string) => {
    last.current = mdx;
    onChange(mdx);
  };
  const flush = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    emit(p.read());
  };
  const schedule = (read: () => string) => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { read, timer: setTimeout(flush, 250) };
  };
  return { last, emit, flush, schedule };
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
  const textStyles = useMemo(
    () => Object.entries(env.textStyles ?? {}),
    [env.textStyles],
  );
  const state = useEditorState({
    editor,
    selector: ({ editor }) => toolbarState(editor, textStyles),
  });
  const disabled = mode === "source";
  const mdx = format === "mdx";
  const run = (command: (chain: ChainedCommands) => ChainedCommands) => () =>
    command(editor.chain().focus()).run();
  const tool = (
    label: string,
    active: boolean,
    icon: ReactNode,
    onRun: () => void,
    isDisabled = false,
  ) => (
    <Tool
      label={label}
      active={active}
      onRun={onRun}
      disabled={disabled || isDisabled}
    >
      {icon}
    </Tool>
  );

  return (
    <div className="v-rte__toolbar">
      {tool(
        "Undo",
        false,
        <Undo2 />,
        run((c) => c.undo()),
        !state.canUndo,
      )}
      {tool(
        "Redo",
        false,
        <Redo2 />,
        run((c) => c.redo()),
        !state.canRedo,
      )}
      <span className="v-rte__sep" />
      {([1, 2, 3] as const).map((level) => {
        const HeadingIcon = HEADING_ICONS[level];
        return (
          <Tool
            key={level}
            label={`Heading ${level}`}
            active={state.headings[level - 1]}
            disabled={disabled}
            onRun={run((c) => c.toggleHeading({ level }))}
          >
            <HeadingIcon />
          </Tool>
        );
      })}
      <span className="v-rte__sep" />
      {tool(
        "Bold",
        state.bold,
        <LetterB />,
        run((c) => c.toggleBold()),
      )}
      {tool(
        "Italic",
        state.italic,
        <Italic />,
        run((c) => c.toggleItalic()),
      )}
      {tool(
        "Strikethrough",
        state.strike,
        <Strikethrough />,
        run((c) => c.toggleStrike()),
      )}
      {mdx && (
        <>
          {tool(
            "Underline",
            state.underline,
            <UnderlineIcon />,
            run((c) => c.toggleUnderline()),
          )}
          {tool(
            "Small text",
            state.small,
            <ALargeSmall />,
            run((c) => c.toggleSmall()),
          )}
        </>
      )}
      {tool(
        "Inline code",
        state.code,
        <Code />,
        run((c) => c.toggleCode()),
      )}
      {mdx && (
        <>
          {tool(
            "Superscript",
            state.sup,
            <SupIcon />,
            run((c) => c.toggleSuperscript()),
          )}
          {tool(
            "Subscript",
            state.sub,
            <SubIcon />,
            run((c) => c.toggleSubscript()),
          )}
        </>
      )}
      <LinkTool editor={editor} active={state.link} disabled={disabled} />
      {mdx && (
        <StylesMenu
          editor={editor}
          textStyles={textStyles}
          active={state.styles}
          disabled={disabled}
        />
      )}
      <span className="v-rte__sep" />
      {tool(
        "Bullet list",
        state.bullet,
        <List />,
        run((c) => c.toggleBulletList()),
      )}
      {tool(
        "Numbered list",
        state.ordered,
        <ListOrdered />,
        run((c) => c.toggleOrderedList()),
      )}
      {tool(
        "Quote",
        state.quote,
        <Quote />,
        run((c) => c.toggleBlockquote()),
      )}
      {tool(
        "Code block",
        state.codeBlock,
        <CodeXml />,
        run((c) => c.toggleCodeBlock()),
      )}
      {tool(
        "Divider",
        false,
        <Minus />,
        run((c) => c.setHorizontalRule()),
      )}
      <ImageTool editor={editor} onUpload={onUpload} disabled={disabled} />
      <TableMenu editor={editor} inTable={state.table} disabled={disabled} />
      {mdx && (
        <InsertMenu
          editor={editor}
          components={components}
          disabled={disabled}
        />
      )}
      <span className="v-rte__spacer" />
      <ModeSwitch mode={mode} onMode={onMode} />
    </div>
  );
}

const HEADING_ICONS = { 1: Heading1, 2: Heading2, 3: Heading3 };

/** Which marks and blocks the selection has, and whether undo and redo can run. */
function toolbarState(
  editor: Editor,
  textStyles: [string, { class: string }][],
) {
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    underline: editor.isActive("underline"),
    small: editor.isActive("small"),
    // The classes of the configured styles that the selection carries.
    styles: textStyles
      .map(([, style]) => style.class)
      .filter((c) => editor.isActive("textClass", { class: c })),
    code: editor.isActive("code"),
    sup: editor.isActive("superscript"),
    sub: editor.isActive("subscript"),
    link: editor.isActive("link"),
    headings: [1, 2, 3].map((level) => editor.isActive("heading", { level })),
    bullet: editor.isActive("bulletList"),
    ordered: editor.isActive("orderedList"),
    quote: editor.isActive("blockquote"),
    codeBlock: editor.isActive("codeBlock"),
    table: editor.isActive("table"),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

/** Keeps the editor's selection when a toolbar button is pressed. */
const keepSelection = (e: React.MouseEvent) => e.preventDefault();

function Tool({
  label,
  active,
  disabled,
  onRun,
  children,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onRun: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx("v-rte__tool", active && "is-active")}
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={onRun}
    >
      {children}
    </button>
  );
}

/** "Link", opening the link dialog, or "Remove link" inside one. */
function LinkTool({
  editor,
  active,
  disabled,
}: {
  editor: Editor;
  active: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {active ? (
        <Tool
          label="Remove link"
          active
          disabled={disabled}
          onRun={() => editor.chain().focus().unsetLink().run()}
        >
          <Unlink />
        </Tool>
      ) : (
        <Tool
          label="Link"
          active={false}
          disabled={disabled}
          onRun={() => setOpen(true)}
        >
          <LinkIcon />
        </Tool>
      )}
      {open && <LinkDialog editor={editor} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Opens the asset picker and inserts the chosen image. */
function ImageTool({
  editor,
  onUpload,
  disabled,
}: {
  editor: Editor;
  onUpload?: RichTextEditorProps["onUpload"];
  disabled: boolean;
}) {
  const env = useEditorEnv();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tool
        label="Image"
        active={false}
        disabled={disabled || !env.imageDirectory}
        onRun={() => setOpen(true)}
      >
        <ImageIcon />
      </Tool>
      {open && env.imageDirectory && (
        <AssetPicker
          directory={env.imageDirectory}
          accept={IMAGE_EXTENSIONS}
          title="Insert image"
          deferUploads={Boolean(onUpload)}
          onClose={() => setOpen(false)}
          onPick={(path, upload) => {
            if (upload) onUpload?.(upload);
            editor
              .chain()
              .focus()
              .setImage({ src: env.toDocPath(path), alt: "" })
              .run();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/** The configured text styles, each toggled on the selection. */
function StylesMenu({
  editor,
  textStyles,
  active,
  disabled,
}: {
  editor: Editor;
  textStyles: [string, TextStyleConfig][];
  /** The classes the selection carries. */
  active: string[];
  disabled: boolean;
}) {
  if (textStyles.length === 0) return null;
  return (
    <Menu
      trigger={({ toggle }) => (
        <button
          type="button"
          className={cx("v-rte__styles", active.length > 0 && "is-active")}
          title="Text styles"
          disabled={disabled}
          onMouseDown={keepSelection}
          onClick={toggle}
        >
          Styles <ChevronDown />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="v-menu__heading">Text styles</div>
          {textStyles.map(([key, style]) => {
            const on = active.includes(style.class);
            return (
              <button
                key={key}
                className="v-menu__item"
                role="menuitemcheckbox"
                aria-checked={on}
                onMouseDown={keepSelection}
                onClick={() => {
                  editor.chain().focus().toggleTextClass(style.class).run();
                  close();
                }}
              >
                <Check style={{ visibility: on ? "visible" : "hidden" }} />
                <span style={cssToStyle(style.css)}>{style.label}</span>
              </button>
            );
          })}
        </>
      )}
    </Menu>
  );
}

/** Commands on the table around the selection, offered inside one. */
const TABLE_COMMANDS: {
  label: string;
  run: (c: ChainedCommands) => ChainedCommands;
  danger?: boolean;
}[] = [
  { label: "Add row below", run: (c) => c.addRowAfter() },
  { label: "Add column after", run: (c) => c.addColumnAfter() },
  { label: "Delete row", run: (c) => c.deleteRow() },
  { label: "Delete column", run: (c) => c.deleteColumn() },
  { label: "Delete table", run: (c) => c.deleteTable(), danger: true },
];

function TableMenu({
  editor,
  inTable,
  disabled,
}: {
  editor: Editor;
  inTable: boolean;
  disabled: boolean;
}) {
  const commands = [
    {
      label: "Insert table",
      run: (c: ChainedCommands) =>
        c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
      danger: false,
    },
    ...(inTable ? TABLE_COMMANDS : []),
  ];
  return (
    <Menu
      trigger={({ toggle }) => (
        <button
          type="button"
          className={cx("v-rte__tool", inTable && "is-active")}
          title="Table"
          disabled={disabled}
          onMouseDown={keepSelection}
          onClick={toggle}
        >
          <TableIcon />
        </button>
      )}
    >
      {(close) =>
        commands.map((command) => (
          <button
            key={command.label}
            className={cx("v-menu__item", command.danger && "is-danger")}
            onClick={() => {
              command.run(editor.chain().focus()).run();
              close();
            }}
          >
            {command.label}
          </button>
        ))
      }
    </Menu>
  );
}

/** The components this document may use, each inserted with its default props. */
function InsertMenu({
  editor,
  components,
  disabled,
}: {
  editor: Editor;
  components: string[];
  disabled: boolean;
}) {
  const env = useEditorEnv();
  if (components.length === 0) return null;
  return (
    <>
      <span className="v-rte__sep" />
      <Menu
        trigger={({ toggle }) => (
          <button
            type="button"
            className="v-rte__insert"
            disabled={disabled}
            onMouseDown={keepSelection}
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
                    insertComponent(editor, name, c);
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
  );
}

/** Inserts component `name` at the selection: inline, or as a block. */
function insertComponent(
  editor: Editor,
  name: string,
  cfg: ComponentConfig | undefined,
) {
  const props = defaultValues(cfg?.props ?? {});
  const hasChildren = Boolean(cfg?.children);
  const node: PMNode = cfg?.inline
    ? {
        type: "mdxInlineComponent",
        attrs: { name, props, hasChildren },
        content: hasChildren ? [{ type: "text", text: "text" }] : [],
      }
    : {
        type: "mdxComponent",
        attrs: { name, props, hasChildren },
        content: hasChildren ? [{ type: "paragraph" }] : [],
      };
  editor.chain().focus().insertContent(node).run();
}

function ModeSwitch({
  mode,
  onMode,
}: {
  mode: "visual" | "source";
  onMode: (m: "visual" | "source") => void;
}) {
  return (
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
        <CodeXml size={14} style={{ marginRight: 4, verticalAlign: -2 }} />{" "}
        Source
      </button>
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

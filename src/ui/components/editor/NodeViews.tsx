import {
  NodeViewContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
} from "@tiptap/react";
import {
  ChevronDown,
  ChevronRight,
  CodeXml,
  Settings2,
  Trash,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Field, Schema } from "../../../config/types.js";
import { isRawExpression } from "../../../mdx/types.js";
import { cx, fieldLabel, summarize } from "../../lib/utils.js";
import { Icon } from "../Icon.js";
import { Button, Modal } from "../ui.js";
import { CodeInput } from "../fields/CodeInput.js";
import { FieldRenderer } from "../fields/FieldRenderer.js";
import { useEditorEnv } from "./EditorContext.js";
import { assetToRepoPath } from "../../../core/values.js";

/** Repo path of an image prop value (values are already repo paths in the editor; tolerate stored forms too). */
function assetPath(field: { directory: string }, value: string): string {
  return assetToRepoPath(field, value, "");
}

/**
 * Keeps a value in local state while also pushing it to the document.
 *
 * Node-view edits reach the document through a ProseMirror transaction, and
 * the re-render with the new attrs arrives a tick later. A plain controlled
 * input therefore sees its old value restored and then replaced, which
 * throws the caret to the end on every keystroke. Local state re-renders
 * synchronously; external changes (undo, a reload) still flow in because
 * the document value is re-adopted whenever it differs from what we sent.
 */
function useDocumentValue<T>(
  value: T,
  commit: (next: T) => void,
): [T, (next: T) => void] {
  const [local, setLocal] = useState(value);
  const sent = useRef(value);
  useEffect(() => {
    if (value !== sent.current && !deepEqual(value, sent.current)) {
      sent.current = value;
      setLocal(value);
    }
  }, [value]);
  const update = useCallback(
    (next: T) => {
      sent.current = next;
      setLocal(next);
      commit(next);
    },
    [commit],
  );
  return [local, update];
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function PropsForm({
  schema,
  props: docProps,
  onChange,
}: {
  schema: Schema;
  props: Record<string, unknown>;
  onChange: (props: Record<string, unknown>) => void;
}) {
  const [props, setProps] = useDocumentValue(docProps, onChange);
  const keys = new Set([...Object.keys(schema), ...Object.keys(props)]);
  return (
    <div className="v-fields">
      {[...keys].map((key) => {
        const field: Field | undefined = schema[key];
        const value = props[key];
        const raw = isRawExpression(value);
        if (!field || raw) {
          // Unknown prop or non-literal expression: edit as code.
          return (
            <div key={key} className="v-field">
              <label className="v-field__label">
                {field ? fieldLabel(key, field) : key}
                <span className="v-field__key">
                  {raw ? "expression" : "unknown prop"}
                </span>
              </label>
              <CodeInput
                value={raw ? value.$raw : JSON.stringify(value, null, 2)}
                language="javascript"
                rows={3}
                onChange={(v) => setProps({ ...props, [key]: { $raw: v } })}
              />
            </div>
          );
        }
        if (field.hidden) return null;
        return (
          <div
            key={key}
            className={cx(
              "v-field",
              field.width === "half" && "v-field--half",
              field.width === "third" && "v-field--third",
            )}
          >
            <FieldRenderer
              fieldKey={key}
              path={key}
              field={field}
              value={value}
              onChange={(v) => setProps({ ...props, [key]: v })}
            />
          </div>
        );
      })}
    </div>
  );
}

function summaryOf(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === "") continue;
    if (isRawExpression(v)) parts.push(`${k}={…}`);
    else if (typeof v === "string")
      parts.push(`${k}="${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`);
    else if (Array.isArray(v))
      parts.push(`${k}: ${v.length} item${v.length === 1 ? "" : "s"}`);
    else if (typeof v === "object")
      parts.push(`${k}: ${summarize(v) || "{…}"}`);
    else parts.push(`${k}=${String(v)}`);
  }
  return parts.join(" · ");
}

export function ComponentNodeView({
  node,
  updateAttributes,
  deleteNode,
  selected,
}: ReactNodeViewProps) {
  const env = useEditorEnv();
  const commitProps = useCallback(
    (p: Record<string, unknown>) => updateAttributes({ props: p }),
    [updateAttributes],
  );
  const name = String(node.attrs.name);
  const config = env.components[name];
  const props = (node.attrs.props ?? {}) as Record<string, unknown>;
  const schema = config?.props ?? {};
  const [open, setOpen] = useState(
    () =>
      Object.keys(schema).length > 0 &&
      Object.values(schema).every(
        (f) => f.type !== "array" && f.type !== "object",
      ),
  );
  const thumbnail = Object.entries(schema).find(
    ([k, f]) => f.type === "image" && typeof props[k] === "string" && props[k],
  );
  const acceptsChildren = config
    ? Boolean(config.children)
    : node.childCount > 0 || Boolean(node.attrs.hasChildren);
  const hasProps =
    Object.keys(schema).length > 0 || Object.keys(props).length > 0;

  return (
    <NodeViewWrapper
      className={cx(
        "v-block",
        selected && "is-selected",
        !open && !acceptsChildren && "is-collapsed",
      )}
    >
      <div
        className="v-block__header"
        contentEditable={false}
        data-drag-handle=""
      >
        <span className="v-block__icon">
          <Icon name={config?.icon ?? "box"} />
        </span>
        <span className="v-block__name">{config?.label ?? name}</span>
        {thumbnail && (
          <img
            className="v-thumb"
            style={{ width: 36, height: 26 }}
            src={
              env.resolveImage?.(
                env.toDocPath(
                  assetPath(
                    schema[thumbnail[0]] as { directory: string },
                    String(props[thumbnail[0]]),
                  ),
                ),
              ) ?? ""
            }
            alt=""
          />
        )}
        <span className="v-block__summary">
          {!open ? summaryOf(props) : config?.description}
        </span>
        <div className="v-block__actions">
          {hasProps && (
            <Button
              variant="ghost"
              size="xs"
              icon
              title={open ? "Hide settings" : "Edit settings"}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <ChevronDown /> : <Settings2 />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            icon
            title="Remove block"
            onClick={deleteNode}
          >
            <Trash />
          </Button>
        </div>
      </div>
      {open && hasProps && (
        <div className="v-block__props" contentEditable={false}>
          <PropsForm schema={schema} props={props} onChange={commitProps} />
        </div>
      )}
      {acceptsChildren && (
        <div className="v-block__children">
          <NodeViewContent className="v-prose v-prose-nested" />
        </div>
      )}
      {!config && !acceptsChildren && !hasProps && (
        <div className="v-block__empty">Unknown component with no props.</div>
      )}
    </NodeViewWrapper>
  );
}

export function InlineComponentNodeView({
  node,
  updateAttributes,
  deleteNode,
}: ReactNodeViewProps) {
  const env = useEditorEnv();
  const commitProps = useCallback(
    (p: Record<string, unknown>) => updateAttributes({ props: p }),
    [updateAttributes],
  );
  const name = String(node.attrs.name);
  const config = env.components[name];
  const [editing, setEditing] = useState(false);
  const props = (node.attrs.props ?? {}) as Record<string, unknown>;
  return (
    <NodeViewWrapper
      as="span"
      className="v-inline-component"
      data-name={name}
      onDoubleClick={() => setEditing(true)}
    >
      <NodeViewContent<"span"> as="span" />
      {editing && (
        <Modal
          title={`${config?.label ?? name} settings`}
          onClose={() => setEditing(false)}
          footer={
            <>
              <Button variant="danger" onClick={deleteNode}>
                <Trash /> Remove
              </Button>
              <Button variant="primary" onClick={() => setEditing(false)}>
                Done
              </Button>
            </>
          }
        >
          <PropsForm
            schema={config?.props ?? {}}
            props={props}
            onChange={commitProps}
          />
        </Modal>
      )}
    </NodeViewWrapper>
  );
}

const RAW_LABELS: Record<string, { label: string; hint: string }> = {
  expression: {
    label: "Expression",
    hint: "JavaScript expression rendered by MDX",
  },
  esm: { label: "Module code", hint: "Imports and exports kept verbatim" },
  html: { label: "Raw HTML", hint: "Passed through as-is" },
};

export function RawBlockNodeView({
  node,
  updateAttributes,
  deleteNode,
  selected,
}: ReactNodeViewProps) {
  const kind = String(node.attrs.kind ?? "expression");
  const [open, setOpen] = useState(false);
  const meta = RAW_LABELS[kind] ?? RAW_LABELS.expression;
  const commitValue = useCallback(
    (v: string) => updateAttributes({ value: v }),
    [updateAttributes],
  );
  const [value, setValue] = useDocumentValue(
    String(node.attrs.value ?? ""),
    commitValue,
  );
  return (
    <NodeViewWrapper
      className={cx("v-block v-block--raw", selected && "is-selected")}
    >
      <div
        className="v-block__header"
        contentEditable={false}
        data-drag-handle=""
      >
        <span className="v-block__icon">
          <CodeXml />
        </span>
        <span className="v-block__name">{meta.label}</span>
        <span className="v-block__summary">{meta.hint}</span>
        <div className="v-block__actions">
          <Button
            variant="ghost"
            size="xs"
            icon
            title={open ? "Collapse" : "Edit"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronDown /> : <ChevronRight />}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            icon
            title="Remove"
            onClick={deleteNode}
          >
            <Trash />
          </Button>
        </div>
      </div>
      <div contentEditable={false}>
        {open ? (
          <div className="v-block__code">
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              spellCheck={false}
            />
          </div>
        ) : (
          <pre className="v-block__code">
            {kind === "expression" ? `{${value}}` : value}
          </pre>
        )}
      </div>
    </NodeViewWrapper>
  );
}

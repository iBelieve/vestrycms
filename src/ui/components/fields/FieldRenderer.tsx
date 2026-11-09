import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  GripVertical,
  Image as ImageIcon,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import type { Field, Schema } from "../../../config/types.js";
import { useVestry } from "../../context.js";
import {
  basename,
  cx,
  defaultValue,
  fieldLabel,
  isImagePath,
  slugify,
  summarize,
  type ValidationError,
} from "../../lib/utils.js";
import { AssetPicker, type PendingUpload } from "../AssetPicker.js";
import { Button, Toggle } from "../ui.js";
import { MarkdownField } from "./MarkdownField.js";
import { CodeInput } from "./CodeInput.js";
import { CropInput, FocalPointInput } from "./ImageTools.js";
import { TreeInput } from "./TreeInput.js";

export interface FieldContext {
  /** Collects files picked through image/file fields so they're committed with the entry. */
  addUpload?: (upload: PendingUpload) => void;
  pendingUploads?: Record<string, PendingUpload>;
  /** Marks the entry as new so slug fields auto-fill. */
  isNew?: boolean;
  /** Values of sibling fields (for slug `from`). */
  siblings?: Record<string, unknown>;
}

export interface FieldProps<F extends Field = Field> {
  fieldKey: string;
  path: string;
  field: F;
  value: unknown;
  onChange: (value: unknown) => void;
  errors?: ValidationError[];
  ctx?: FieldContext;
  /** Omit the label (e.g. when the surrounding card already names the field). */
  hideLabel?: boolean;
}

/** Renders a schema as a responsive grid of fields. */
export function FieldSet({
  schema,
  values,
  onChange,
  errors,
  filter,
  ctx,
  pathPrefix = "",
  hideLabels,
}: {
  schema: Schema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  errors?: ValidationError[];
  filter?: (key: string, field: Field) => boolean;
  ctx?: FieldContext;
  pathPrefix?: string;
  /** Keys whose label should be omitted. */
  hideLabels?: string[];
}) {
  const entries = Object.entries(schema).filter(
    ([k, f]) => !f.hidden && (!filter || filter(k, f)),
  );
  if (!entries.length) return null;
  return (
    <div className="v-fields">
      {entries.map(([key, field]) => (
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
            path={pathPrefix ? `${pathPrefix}.${key}` : key}
            field={field}
            value={values[key]}
            onChange={(v) => onChange({ ...values, [key]: v })}
            errors={errors}
            ctx={{ ...ctx, siblings: values }}
            hideLabel={hideLabels?.includes(key)}
          />
        </div>
      ))}
    </div>
  );
}

export function FieldRenderer(props: FieldProps) {
  const { field, fieldKey, path, errors } = props;
  const id = useId();
  const error = errors?.find((e) => e.path === path)?.message;
  const label = fieldLabel(fieldKey, field);
  const inline = field.type === "boolean";
  return (
    <div className={cx(error && "has-error")}>
      {!inline && !props.hideLabel && (
        <label className="v-field__label" htmlFor={id}>
          {label}
          {field.required && <span className="v-field__required">*</span>}
        </label>
      )}
      <FieldInput {...props} id={id} label={label} />
      {field.type === "date" &&
        field.timeHint &&
        typeof props.value === "string" &&
        props.value.length <= 10 && (
          <div className="v-field__hint">Time: {field.timeHint}</div>
        )}
      {field.description && (
        <div className="v-field__hint">{field.description}</div>
      )}
      {error && <div className="v-field__error">{error}</div>}
    </div>
  );
}

function FieldInput(props: FieldProps & { id: string; label: string }) {
  const { field, value, onChange, id, label, ctx } = props;
  const readOnly = field.readOnly;
  switch (field.type) {
    case "text":
      return (
        <input
          id={id}
          className="v-input"
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "slug":
      return (
        <SlugInput
          id={id}
          value={(value as string) ?? ""}
          onChange={onChange}
          from={field.from}
          ctx={ctx}
          readOnly={readOnly}
        />
      );
    case "textarea":
      return (
        <textarea
          id={id}
          className="v-textarea"
          rows={field.rows ?? 4}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <input
          id={id}
          type="number"
          className="v-input"
          value={value === null || value === undefined ? "" : String(value)}
          min={field.min}
          max={field.max}
          step={field.step ?? "any"}
          readOnly={readOnly}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
        />
      );
    case "boolean":
      return (
        <Toggle
          checked={Boolean(value)}
          onChange={onChange}
          label={label}
          disabled={readOnly}
        />
      );
    case "date": {
      const str =
        typeof value === "string"
          ? value
          : value instanceof Date
            ? value.toISOString()
            : "";
      const datePart = str.slice(0, 10);
      const timePart = str.length > 10 ? str.slice(11, 16) : "";
      if (!field.time) {
        return (
          <input
            id={id}
            type="date"
            className="v-input"
            value={datePart}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
          />
        );
      }
      return (
        <div className="v-input-group">
          <input
            id={id}
            type="date"
            className="v-input"
            value={datePart}
            readOnly={readOnly}
            onChange={(e) =>
              onChange(
                timePart && e.target.value
                  ? `${e.target.value}T${timePart}`
                  : e.target.value,
              )
            }
          />
          <input
            type="time"
            className="v-input"
            style={{ flex: "0 0 130px" }}
            value={timePart}
            readOnly={readOnly}
            title={field.timeHint}
            onChange={(e) =>
              onChange(
                e.target.value && datePart
                  ? `${datePart}T${e.target.value}`
                  : datePart,
              )
            }
          />
        </div>
      );
    }
    case "datetime": {
      if (field.autoUpdate) {
        return (
          <input
            id={id}
            className="v-input"
            readOnly
            value={
              value ? new Date(String(value)).toLocaleString() : "Set on save"
            }
          />
        );
      }
      return (
        <DatetimeInput
          id={id}
          value={value}
          storage={field.storage ?? "local"}
          onChange={onChange}
          readOnly={readOnly}
        />
      );
    }
    case "select":
      return (
        <div className="v-row">
          {field.options.find((o) => o.value === value)?.color && (
            <span
              className="v-swatch"
              style={{
                background: field.options.find((o) => o.value === value)!.color,
              }}
            />
          )}
          <select
            id={id}
            className="v-select"
            value={(value as string) ?? ""}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.value || undefined)}
          >
            {(field.clearable || value === undefined || value === "") && (
              <option value="">—</option>
            )}
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="v-chips">
          {field.options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                className={cx("v-chip", on && "is-on")}
                onClick={() =>
                  onChange(
                    on
                      ? selected.filter((v) => v !== o.value)
                      : [...selected, o.value],
                  )
                }
                disabled={readOnly}
              >
                {o.color && (
                  <span className="v-swatch" style={{ background: o.color }} />
                )}
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    case "color":
      return (
        <div className="v-input-group">
          <input
            type="color"
            value={(value as string) || "#000000"}
            onChange={(e) => onChange(e.target.value)}
            disabled={readOnly}
            style={{ width: 44, height: 36, padding: 2 }}
          />
          <input
            id={id}
            className="v-input v-input--mono"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            readOnly={readOnly}
          />
        </div>
      );
    case "image":
    case "file":
      return <AssetInput {...props} />;
    case "reference":
      return (
        <ReferenceInput
          id={id}
          collection={field.collection}
          value={(value as string) ?? ""}
          onChange={onChange}
          readOnly={readOnly}
        />
      );
    case "object": {
      const obj = (value && typeof value === "object" ? value : {}) as Record<
        string,
        unknown
      >;
      const body = (
        <FieldSet
          schema={field.fields}
          values={obj}
          onChange={onChange}
          errors={props.errors}
          ctx={ctx}
          pathPrefix={props.path}
        />
      );
      return field.inline ? (
        body
      ) : (
        <div className="v-group">
          <div className="v-group__body">{body}</div>
        </div>
      );
    }
    case "array":
      return <ArrayInput {...props} field={field} />;
    case "markdown":
      return (
        <MarkdownField
          value={(value as string) ?? ""}
          onChange={onChange}
          components={field.components}
          placeholder={field.description}
        />
      );
    case "code":
      return (
        <CodeInput
          value={(value as string) ?? ""}
          onChange={onChange}
          language={field.language ?? "text"}
          rows={field.rows}
          readOnly={readOnly}
        />
      );
    case "json":
      return (
        <JsonInput value={value} onChange={onChange} readOnly={readOnly} />
      );
    case "crop":
      return (
        <CropInput
          field={field}
          value={value}
          onChange={onChange}
          siblings={ctx?.siblings}
          pendingUploads={ctx?.pendingUploads}
        />
      );
    case "focalPoint":
      return (
        <FocalPointInput
          field={field}
          value={value}
          onChange={onChange}
          siblings={ctx?.siblings}
          pendingUploads={ctx?.pendingUploads}
        />
      );
    case "tree":
      return (
        <TreeInput
          field={field}
          value={value}
          onChange={onChange}
          errors={props.errors}
          ctx={ctx}
          path={props.path}
        />
      );
    default:
      return <input className="v-input" readOnly value={String(value ?? "")} />;
  }
}

function SlugInput({
  id,
  value,
  onChange,
  from,
  ctx,
  readOnly,
}: {
  id: string;
  value: string;
  onChange: (v: unknown) => void;
  from?: string;
  ctx?: FieldContext;
  readOnly?: boolean;
}) {
  const source = from ? ctx?.siblings?.[from] : undefined;
  const suggestion = typeof source === "string" ? slugify(source) : "";
  return (
    <div className="v-input-group">
      <input
        id={id}
        className="v-input v-input--mono"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        placeholder={suggestion || undefined}
      />
      {suggestion && suggestion !== value && !readOnly && (
        <Button size="sm" onClick={() => onChange(suggestion)}>
          Generate
        </Button>
      )}
    </div>
  );
}

function DatetimeInput({
  id,
  value,
  storage,
  onChange,
  readOnly,
}: {
  id: string;
  value: unknown;
  storage: "local" | "iso";
  onChange: (v: unknown) => void;
  readOnly?: boolean;
}) {
  // Display in local wall-clock; store either as `YYYY-MM-DDTHH:mm` or ISO.
  let display = "";
  if (typeof value === "string" && value) {
    if (storage === "local") display = value.slice(0, 16);
    else {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, "0");
        display = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }
  }
  return (
    <input
      id={id}
      type="datetime-local"
      className="v-input"
      value={display}
      readOnly={readOnly}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return onChange("");
        onChange(storage === "local" ? v : new Date(v).toISOString());
      }}
    />
  );
}

function AssetInput(props: FieldProps) {
  const { api } = useVestry();
  const field = props.field as Extract<Field, { type: "image" | "file" }>;
  const value = (props.value as string) ?? "";
  const [open, setOpen] = useState(false);
  const pending = props.ctx?.pendingUploads?.[value];
  const isImage = field.type === "image" || isImagePath(value);
  const previewUrl = value
    ? pending
      ? pending.previewUrl
      : /^https?:/.test(value)
        ? value
        : api.fileUrl(value)
    : null;
  const accept =
    field.accept ??
    (field.type === "image"
      ? ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"]
      : undefined);
  return (
    <div className="v-image-field">
      <div className="v-image-field__preview">
        {previewUrl && isImage ? (
          <img src={previewUrl} alt="" />
        ) : (
          <ImageIcon />
        )}
      </div>
      <div className="v-image-field__info">
        {value ? (
          <div className="v-image-field__path">
            <strong style={{ color: "var(--v-text)" }}>
              {basename(value)}
            </strong>
            <br />
            {value.slice(0, value.length - basename(value).length)}
          </div>
        ) : (
          <div className="v-muted" style={{ marginBottom: 8 }}>
            No file selected
          </div>
        )}
        <div className="v-image-field__actions">
          <Button
            size="sm"
            onClick={() => setOpen(true)}
            disabled={field.readOnly}
          >
            {value ? "Replace" : "Choose"}
          </Button>
          {value && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => props.onChange("")}
              disabled={field.readOnly}
            >
              <X /> Clear
            </Button>
          )}
        </div>
      </div>
      {open && (
        <AssetPicker
          directory={field.directory}
          accept={accept}
          allowUpload={field.upload !== false}
          title={field.type === "image" ? "Choose an image" : "Choose a file"}
          deferUploads={Boolean(props.ctx?.addUpload)}
          onClose={() => setOpen(false)}
          onPick={(path, upload) => {
            if (upload) props.ctx?.addUpload?.(upload);
            props.onChange(path);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ReferenceInput({
  id,
  collection,
  value,
  onChange,
  readOnly,
}: {
  id: string;
  collection: string;
  value: string;
  onChange: (v: unknown) => void;
  readOnly?: boolean;
}) {
  const { api } = useVestry();
  const q = useQuery({
    queryKey: ["entries", collection],
    queryFn: () => api.listEntries(collection),
    staleTime: 60_000,
  });
  const entries = q.data?.entries ?? [];
  return (
    <select
      id={id}
      className="v-select"
      value={value}
      disabled={readOnly}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{q.isLoading ? "Loading…" : "—"}</option>
      {value && !entries.some((e) => e.slug === value) && (
        <option value={value}>{value}</option>
      )}
      {entries.map((e) => (
        <option key={e.slug} value={e.slug}>
          {e.title}
        </option>
      ))}
    </select>
  );
}

let nextRowId = 0;
const newRowId = () => `row-${++nextRowId}`;

/** Props handed to a row's drag handle by the sortable wrapper. */
interface HandleProps {
  ref: (el: HTMLElement | null) => void;
  listeners: Record<string, unknown>;
  attributes: Record<string, unknown>;
}

/**
 * A sortable list item. dnd-kit moves the neighbours out of the way with
 * transforms so a gap opens where the row will land; the row itself stays in
 * flow as a dimmed placeholder while a clone floats in the DragOverlay.
 */
function SortableRow({
  id,
  className,
  children,
}: {
  id: string;
  className: string;
  children: (handle: HandleProps, dragging: boolean) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cx(className, isDragging && "is-placeholder")}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {children(
        {
          ref: setActivatorNodeRef,
          listeners: {
            ...listeners,
            // Keep the pointer-down from reaching an enclosing rich text
            // editor, which would otherwise treat it as a selection drag.
            onPointerDown: (e: React.PointerEvent) => {
              e.stopPropagation();
              (
                listeners?.onPointerDown as
                  ((e: React.PointerEvent) => void) | undefined
              )?.(e);
            },
          },
          attributes: attributes as unknown as Record<string, unknown>,
        },
        isDragging,
      )}
    </div>
  );
}

function ArrayInput(props: FieldProps<Extract<Field, { type: "array" }>>) {
  const { field, onChange, ctx } = props;
  const items = Array.isArray(props.value) ? (props.value as unknown[]) : [];
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const isObject = field.of.type === "object";

  // Stable ids for dnd-kit, kept parallel to the items array.
  const idsRef = useRef<string[]>([]);
  if (idsRef.current.length < items.length) {
    idsRef.current = [
      ...idsRef.current,
      ...Array.from({ length: items.length - idsRef.current.length }, newRowId),
    ];
  } else if (idsRef.current.length > items.length) {
    idsRef.current = idsRef.current.slice(0, items.length);
  }
  const ids = idsRef.current;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const update = (next: unknown[], nextIds?: string[]) => {
    if (nextIds) idsRef.current = nextIds;
    onChange(next);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    update(arrayMove(items, from, to), arrayMove(ids, from, to));
    setOpenIdx((o) => (o === from ? to : o));
  };
  const remove = (i: number) =>
    update(
      items.filter((_, j) => j !== i),
      ids.filter((_, j) => j !== i),
    );
  const duplicate = (i: number) =>
    update(
      [
        ...items.slice(0, i + 1),
        JSON.parse(JSON.stringify(items[i])),
        ...items.slice(i + 1),
      ],
      [...ids.slice(0, i + 1), newRowId(), ...ids.slice(i + 1)],
    );
  const setItem = (i: number, v: unknown) =>
    update(items.map((x, j) => (j === i ? v : x)));

  const moveButtons = (i: number) => (
    <>
      <Button
        variant="ghost"
        size="xs"
        icon
        title="Move up"
        onClick={() => move(i, i - 1)}
        disabled={i === 0}
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        icon
        title="Move down"
        onClick={() => move(i, i + 1)}
        disabled={i === items.length - 1}
      >
        <ChevronDown />
      </Button>
    </>
  );

  /** Header of an object item; `overlay` renders a static clone for the drag preview. */
  const objectHeader = (
    i: number,
    open: boolean,
    handle: HandleProps | null,
  ) => {
    const item = items[i];
    const title =
      summarize(item, field) || `${fieldLabel("item", field.of)} ${i + 1}`;
    return (
      <div
        className="v-list__header"
        onClick={handle ? () => setOpenIdx(open ? null : i) : undefined}
      >
        <span
          className="v-list__handle"
          title="Drag to reorder"
          ref={handle?.ref}
          {...(handle?.listeners ?? {})}
          {...(handle?.attributes ?? {})}
        >
          <GripVertical />
        </span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="v-list__title">{title}</span>
        {handle && (
          <div className="v-list__actions" onClick={(e) => e.stopPropagation()}>
            {moveButtons(i)}
            <Button
              variant="ghost"
              size="xs"
              icon
              title="Duplicate"
              onClick={() => duplicate(i)}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              icon
              title="Remove"
              onClick={() => remove(i)}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
    );
  };

  const scalarRow = (i: number, handle: HandleProps | null) => (
    <>
      <span
        className="v-list__handle"
        title="Drag to reorder"
        ref={handle?.ref}
        {...(handle?.listeners ?? {})}
        {...(handle?.attributes ?? {})}
      >
        <GripVertical />
      </span>
      <div className="v-grow">
        <FieldInput
          fieldKey={`${props.fieldKey}.${i}`}
          path={`${props.path}.${i}`}
          field={field.of}
          value={items[i]}
          onChange={(v) => setItem(i, v)}
          errors={props.errors}
          ctx={ctx}
          id={handle ? `${props.path}.${i}` : `${props.path}.${i}.overlay`}
          label=""
        />
      </div>
      <div className="v-list__actions">
        {moveButtons(i)}
        <Button
          variant="ghost"
          size="xs"
          icon
          title="Remove"
          onClick={() => remove(i)}
        >
          <Trash2 />
        </Button>
      </div>
    </>
  );

  const rowClass = (i: number) =>
    cx(
      isObject ? "v-list__item" : "v-list__row",
      isDisabled(items[i]) && "is-disabled",
    );
  const activeIdx = activeId ? ids.indexOf(activeId) : -1;

  return (
    <div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragStart={(e: DragStartEvent) => {
          setActiveId(String(e.active.id));
          if (isObject) setOpenIdx(null);
        }}
        onDragEnd={(e: DragEndEvent) => {
          setActiveId(null);
          const from = ids.indexOf(String(e.active.id));
          const to = e.over ? ids.indexOf(String(e.over.id)) : -1;
          if (from !== -1 && to !== -1) move(from, to);
        }}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="v-list">
            {items.map((item, i) => {
              const open = openIdx === i;
              return (
                <SortableRow key={ids[i]} id={ids[i]} className={rowClass(i)}>
                  {(handle) =>
                    isObject ? (
                      <>
                        {objectHeader(i, open, handle)}
                        {open && (
                          <div className="v-list__body">
                            <FieldSet
                              schema={(field.of as { fields: Schema }).fields}
                              values={(item ?? {}) as Record<string, unknown>}
                              onChange={(v) => setItem(i, v)}
                              errors={props.errors}
                              ctx={ctx}
                              pathPrefix={`${props.path}.${i}`}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      scalarRow(i, handle)
                    )
                  }
                </SortableRow>
              );
            })}
          </div>
        </SortableContext>
        {createPortal(
          <DragOverlay
            dropAnimation={{
              duration: 180,
              easing: "cubic-bezier(0.2, 0, 0, 1)",
            }}
          >
            {activeIdx !== -1 && (
              <div className={cx(rowClass(activeIdx), "v-list__ghost")}>
                {isObject
                  ? objectHeader(activeIdx, false, null)
                  : scalarRow(activeIdx, null)}
              </div>
            )}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      <Button
        size="sm"
        className="v-list__add"
        disabled={field.max !== undefined && items.length >= field.max}
        onClick={() => {
          update([...items, defaultValue(field.of)], [...ids, newRowId()]);
          setOpenIdx(items.length);
        }}
      >
        <Plus /> {field.addLabel ?? "Add item"}
      </Button>
    </div>
  );
}

function JsonInput({
  value,
  onChange,
  readOnly,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly?: boolean;
}) {
  const [text, setText] = useState(() =>
    value === undefined ? "" : JSON.stringify(value, null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <CodeInput
        value={text}
        language="json"
        readOnly={readOnly}
        onChange={(t) => {
          setText(t);
          if (!t.trim()) {
            setError(null);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(t));
            setError(null);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      {error && <div className="v-field__error">{error}</div>}
    </div>
  );
}

/** Items with `enabled: false` (a common toggle in page-builder data) are shown dimmed. */
function isDisabled(item: unknown): boolean {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as Record<string, unknown>).enabled === false
  );
}

export function FieldGroup({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="v-card">
      <div className="v-card__header">
        <h3 className="v-card__title">{title}</h3>
      </div>
      <div className="v-card__body">{children}</div>
    </div>
  );
}

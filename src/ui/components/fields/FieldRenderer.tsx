import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  GripVertical,
  Image as ImageIcon,
  Plus,
  Trash,
  X,
} from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
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
import { basename, slugify } from "../../../core/paths.js";
import {
  cx,
  defaultValue,
  fieldLabel,
  isImagePath,
  summarize,
  type ValidationError,
} from "../../lib/utils.js";
import { AssetPicker, type PendingUpload } from "../AssetPicker.js";
import { Button, Toggle } from "../ui.js";
import { MarkdownField } from "./MarkdownField.js";
import { CodeInput } from "./CodeInput.js";
import { CropInput, FocalPointInput } from "./ImageTools.js";
import { TreeInput } from "./TreeInput.js";
import { datetimeStorage, localDateTime } from "../../../core/values.js";

export interface FieldContext {
  /** Collects files picked through image/file fields so they're committed with the entry. */
  addUpload?: (upload: PendingUpload) => void;
  pendingUploads?: Record<string, PendingUpload>;
  /** Marks the entry as new so slug fields auto-fill. */
  isNew?: boolean;
  /** Values of sibling fields (for slug `from`). */
  siblings?: Record<string, unknown>;
}

/** Values by field key, as a form holds them. */
type Values = Record<string, unknown>;

/**
 * Changes a form's values. It takes an update of the values as they stand,
 * not the values themselves, so that two fields changing at once (two
 * crops seeding their defaults as their images load) both keep their
 * change instead of the second overwriting the first.
 */
export type ValuesChange = (update: (values: Values) => Values) => void;

const isValues = (value: unknown): value is Values =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * What a field's `onChange` asks for: the value it was given, or, given a
 * function, that update of `current`.
 */
export function changedValue(change: unknown, current: unknown): unknown {
  return typeof change === "function"
    ? (change as (value: unknown) => unknown)(current)
    : change;
}

export interface FieldProps<F extends Field = Field> {
  fieldKey: string;
  path: string;
  field: F;
  value: unknown;
  /**
   * Sets the field's value. A function is an update of its current value
   * instead (from the form an object, list item or tree item nests), so
   * whatever renders a field resolves it with `changedValue`.
   */
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
  values: Values;
  onChange: ValuesChange;
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
            onChange={(v) =>
              onChange((current) => ({
                ...current,
                [key]: changedValue(v, current[key]),
              }))
            }
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

type InputProps<T extends Field["type"] = Field["type"]> = FieldProps<
  Extract<Field, { type: T }>
> & { id: string; label: string };

/** Each type of field's input. */
const INPUTS: { [T in Field["type"]]: (props: InputProps<T>) => ReactNode } = {
  text: ({ field, value, onChange, id }) => (
    <input
      id={id}
      className="v-input"
      value={asText(value)}
      placeholder={field.placeholder}
      maxLength={field.maxLength}
      readOnly={field.readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
  slug: ({ field, value, onChange, id, ctx }) => (
    <SlugInput
      id={id}
      value={asText(value)}
      onChange={onChange}
      from={field.from}
      ctx={ctx}
      readOnly={field.readOnly}
    />
  ),
  textarea: ({ field, value, onChange, id }) => (
    <textarea
      id={id}
      className="v-textarea"
      rows={field.rows ?? 4}
      value={asText(value)}
      placeholder={field.placeholder}
      maxLength={field.maxLength}
      readOnly={field.readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
  number: ({ field, value, onChange, id }) => (
    <input
      id={id}
      type="number"
      className="v-input"
      value={value === null || value === undefined ? "" : String(value)}
      min={field.min}
      max={field.max}
      step={field.step ?? "any"}
      readOnly={field.readOnly}
      onChange={(e) =>
        onChange(e.target.value === "" ? null : Number(e.target.value))
      }
    />
  ),
  boolean: ({ field, value, onChange, label }) => (
    <Toggle
      checked={Boolean(value)}
      onChange={onChange}
      label={label}
      disabled={field.readOnly}
    />
  ),
  date: (props) => <DateInput {...props} />,
  datetime: ({ field, value, onChange, id }) =>
    field.autoUpdate ? (
      <input
        id={id}
        className="v-input"
        readOnly
        value={value ? new Date(String(value)).toLocaleString() : "Set on save"}
      />
    ) : (
      <DatetimeInput
        id={id}
        value={value}
        storage={datetimeStorage(field)}
        onChange={onChange}
        readOnly={field.readOnly}
      />
    ),
  select: (props) => <SelectInput {...props} />,
  multiselect: (props) => <MultiselectInput {...props} />,
  color: ({ field, value, onChange, id }) => (
    <div className="v-input-group">
      <input
        type="color"
        value={(value as string) || "#000000"}
        onChange={(e) => onChange(e.target.value)}
        disabled={field.readOnly}
        style={{ width: 44, height: 36, padding: 2 }}
      />
      <input
        id={id}
        className="v-input v-input--mono"
        value={asText(value)}
        onChange={(e) => onChange(e.target.value)}
        readOnly={field.readOnly}
      />
    </div>
  ),
  image: (props) => <AssetInput {...props} />,
  file: (props) => <AssetInput {...props} />,
  reference: ({ field, value, onChange, id }) => (
    <ReferenceInput
      id={id}
      collection={field.collection}
      value={asText(value)}
      onChange={onChange}
      readOnly={field.readOnly}
    />
  ),
  object: (props) => <ObjectInput {...props} />,
  array: (props) => <ArrayInput {...props} />,
  markdown: ({ field, value, onChange }) => (
    <MarkdownField
      value={asText(value)}
      onChange={onChange}
      components={field.components}
      placeholder={field.description}
    />
  ),
  code: ({ field, value, onChange }) => (
    <CodeInput
      value={asText(value)}
      onChange={onChange}
      language={field.language ?? "text"}
      rows={field.rows}
      readOnly={field.readOnly}
    />
  ),
  json: ({ field, value, onChange }) => (
    <JsonInput value={value} onChange={onChange} readOnly={field.readOnly} />
  ),
  crop: ({ field, value, onChange, ctx }) => (
    <CropInput
      field={field}
      value={value}
      onChange={onChange}
      siblings={ctx?.siblings}
      pendingUploads={ctx?.pendingUploads}
    />
  ),
  focalPoint: ({ field, value, onChange, ctx }) => (
    <FocalPointInput
      field={field}
      value={value}
      onChange={onChange}
      siblings={ctx?.siblings}
      pendingUploads={ctx?.pendingUploads}
    />
  ),
  tree: ({ field, value, onChange, errors, ctx, path }) => (
    <TreeInput
      field={field}
      value={value}
      onChange={onChange}
      errors={errors}
      ctx={ctx}
      path={path}
    />
  ),
};

/** A string value, or "" for none. */
const asText = (value: unknown) => (value as string) ?? "";

function FieldInput(props: InputProps) {
  const type = props.field.type;
  const Input = Object.hasOwn(INPUTS, type)
    ? (INPUTS[type] as (props: InputProps) => ReactNode)
    : null;
  if (!Input)
    return (
      <input className="v-input" readOnly value={String(props.value ?? "")} />
    );
  return <Input {...props} />;
}

/** A date, with a time box beside it for a field that keeps a time. */
function DateInput({ field, value, onChange, id }: InputProps<"date">) {
  const str =
    typeof value === "string"
      ? value
      : value instanceof Date
        ? value.toISOString()
        : "";
  const datePart = str.slice(0, 10);
  const timePart = str.length > 10 ? str.slice(11, 16) : "";
  const readOnly = field.readOnly;
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

function SelectInput({ field, value, onChange, id }: InputProps<"select">) {
  const color = field.options.find((o) => o.value === value)?.color;
  return (
    <div className="v-row">
      {color && <span className="v-swatch" style={{ background: color }} />}
      <select
        id={id}
        className="v-select"
        value={asText(value)}
        disabled={field.readOnly}
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
}

function MultiselectInput({
  field,
  value,
  onChange,
}: InputProps<"multiselect">) {
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
            disabled={field.readOnly}
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

function ObjectInput({
  field,
  value,
  onChange,
  errors,
  ctx,
  path,
}: InputProps<"object">) {
  const obj = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const body = (
    <FieldSet
      schema={field.fields}
      values={obj}
      onChange={(update) =>
        onChange((current: unknown) => update(isValues(current) ? current : {}))
      }
      errors={errors}
      ctx={ctx}
      pathPrefix={path}
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
      if (!Number.isNaN(d.getTime())) display = localDateTime(d);
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
  // Applied to the list as it stands, like the form's own updates.
  const setItem = (i: number, v: unknown) =>
    onChange((current: unknown) =>
      (Array.isArray(current) ? current : []).map((x, j) =>
        j !== i ? x : changedValue(v, x),
      ),
    );
  const updateItem = (i: number, change: (values: Values) => Values) =>
    setItem(i, (x: unknown) => change(isValues(x) ? x : {}));

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
              <Trash />
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
          <Trash />
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
                              onChange={(update) => updateItem(i, update)}
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
            className="v-portal"
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

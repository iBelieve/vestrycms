import type {
  ArrayField,
  BooleanField,
  CodeField,
  ColorField,
  CropField,
  DateField,
  DatetimeField,
  Field,
  FileField,
  FocalPointField,
  ImageField,
  JsonField,
  MarkdownField,
  MultiselectField,
  NumberField,
  ObjectField,
  ReferenceField,
  SelectField,
  SlugField,
  TextField,
  TextareaField,
  TreeField,
} from "./types.js";

type Opts<T extends Field> = Omit<T, "type">;

/**
 * Field builders. Each returns a plain object; the `type` discriminant is all
 * the control panel and the server need.
 */
export const fields = {
  text: (opts: Opts<TextField> = {}): TextField => ({ type: "text", ...opts }),
  textarea: (opts: Opts<TextareaField> = {}): TextareaField => ({
    type: "textarea",
    ...opts,
  }),
  slug: (opts: Opts<SlugField> = {}): SlugField => ({ type: "slug", ...opts }),
  number: (opts: Opts<NumberField> = {}): NumberField => ({
    type: "number",
    ...opts,
  }),
  boolean: (opts: Opts<BooleanField> = {}): BooleanField => ({
    type: "boolean",
    ...opts,
  }),
  date: (opts: Opts<DateField> = {}): DateField => ({ type: "date", ...opts }),
  datetime: (opts: Opts<DatetimeField> = {}): DatetimeField => ({
    type: "datetime",
    ...opts,
  }),
  select: (opts: Opts<SelectField>): SelectField => ({
    type: "select",
    ...opts,
  }),
  multiselect: (opts: Opts<MultiselectField>): MultiselectField => ({
    type: "multiselect",
    ...opts,
  }),
  color: (opts: Opts<ColorField> = {}): ColorField => ({
    type: "color",
    ...opts,
  }),
  image: (opts: Opts<ImageField>): ImageField => ({ type: "image", ...opts }),
  file: (opts: Opts<FileField>): FileField => ({ type: "file", ...opts }),
  reference: (opts: Opts<ReferenceField>): ReferenceField => ({
    type: "reference",
    ...opts,
  }),
  object: (
    fieldsOrOpts: ObjectField["fields"] | Opts<ObjectField>,
    extra: Omit<Opts<ObjectField>, "fields"> = {},
  ): ObjectField => {
    if ("fields" in fieldsOrOpts && isSchema(fieldsOrOpts.fields)) {
      return { type: "object", ...(fieldsOrOpts as Opts<ObjectField>) };
    }
    return {
      type: "object",
      fields: fieldsOrOpts as ObjectField["fields"],
      ...extra,
    };
  },
  /**
   * `array(of, opts)` or, like every other builder, a single options
   * object: `array({ of, addLabel })`.
   */
  array: (
    ofOrOpts: Field | Opts<ArrayField>,
    extra: Omit<Opts<ArrayField>, "of"> = {},
  ): ArrayField => {
    if (!("type" in ofOrOpts)) return { type: "array", ...ofOrOpts };
    return { type: "array", of: ofOrOpts, ...extra };
  },
  markdown: (opts: Opts<MarkdownField> = {}): MarkdownField => ({
    type: "markdown",
    ...opts,
  }),
  code: (opts: Opts<CodeField> = {}): CodeField => ({ type: "code", ...opts }),
  json: (opts: Opts<JsonField> = {}): JsonField => ({ type: "json", ...opts }),
  crop: (opts: Opts<CropField>): CropField => ({ type: "crop", ...opts }),
  focalPoint: (opts: Opts<FocalPointField>): FocalPointField => ({
    type: "focalPoint",
    ...opts,
  }),
  tree: (opts: Opts<TreeField>): TreeField => ({ type: "tree", ...opts }),
};

function isSchema(value: unknown): value is Record<string, Field> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(
      (f) => typeof f === "object" && f !== null && "type" in f,
    )
  );
}

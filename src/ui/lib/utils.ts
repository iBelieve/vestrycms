import type { CSSProperties } from "react";
import type { Field, Schema } from "../../config/types.js";
import { isRawExpression } from "../../mdx/types.js";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;

/**
 * A URL found in text, without the sentence punctuation after it
 * ("…/limits/." or "(…/limits/)").
 */
function trimUrl(found: string): string {
  let url = found;
  for (let prev = ""; prev !== url;) {
    prev = url;
    url = url.replace(/[.,;:!?…”’]+$/, "");
    // A closing bracket is the URL's own only if the URL opened it.
    const close = url.slice(-1);
    const open = close === ")" ? "(" : close === "]" ? "[" : "";
    if (open && url.split(open).length < url.split(close).length)
      url = url.slice(0, -1);
  }
  return url;
}

/** Splits text around the http(s) URLs in it, for rendering them as links. */
export function splitLinks(text: string): { text: string; url?: string }[] {
  const parts: { text: string; url?: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: url, url });
    last = match.index + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function titleCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function fieldLabel(key: string, field: Field): string {
  return field.label ?? titleCase(key);
}

export function formatBytes(n?: number): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const s = String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (dateOnly) {
    const [y, m, day] = s.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Default value for a field (used when creating entries / array items). */
export function defaultValue(field: Field): unknown {
  const of = DEFAULTS[field.type] as ((field: Field) => unknown) | undefined;
  return of?.(field);
}

const textDefault = (field: { default?: string }) => field.default ?? "";

/** The default value of each type of field. */
const DEFAULTS: {
  [Type in Field["type"]]: (field: Extract<Field, { type: Type }>) => unknown;
} = {
  text: textDefault,
  textarea: textDefault,
  slug: textDefault,
  color: textDefault,
  image: textDefault,
  file: textDefault,
  reference: textDefault,
  markdown: textDefault,
  code: textDefault,
  number: (field) => field.default ?? null,
  boolean: (field) => field.default ?? false,
  date: (field) =>
    field.default === "now"
      ? new Date().toISOString().slice(0, 10)
      : (field.default ?? ""),
  datetime: (field) => {
    if (field.default !== "now") return field.default ?? "";
    return field.storage === "local"
      ? new Date().toISOString().slice(0, 16)
      : new Date().toISOString();
  },
  select: (field) =>
    field.default ?? (field.clearable ? "" : (field.options[0]?.value ?? "")),
  multiselect: (field) => field.default ?? [],
  object: (field) => defaultValues(field.fields),
  array: () => [],
  json: (field) => field.default ?? null,
  crop: () => undefined,
  focalPoint: () => undefined,
  tree: () => [],
};

export function defaultValues(schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const v = defaultValue(field);
    if (v !== "" && v !== null && !(Array.isArray(v) && v.length === 0))
      out[key] = v;
    else if (field.type === "boolean") out[key] = v;
  }
  return out;
}

export interface ValidationError {
  path: string;
  message: string;
}

export function validate(
  schema: Schema,
  data: Record<string, unknown>,
  prefix = "",
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [key, field] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = data?.[key];
    const label = fieldLabel(key, field);
    if (isEmpty(value)) {
      if (field.required)
        errors.push({ path, message: `${label} is required` });
      continue;
    }
    const check = CHECKS[field.type] as Check<Field> | undefined;
    if (check) errors.push(...check(field, value, path, label));
  }
  return errors;
}

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

type Check<F> = (
  field: F,
  value: unknown,
  path: string,
  label: string,
) => ValidationError[];

function maxLengthErrors(
  field: { maxLength?: number },
  value: unknown,
  path: string,
  label: string,
): ValidationError[] {
  return field.maxLength &&
    typeof value === "string" &&
    value.length > field.maxLength
    ? [
        {
          path,
          message: `${label} must be at most ${field.maxLength} characters`,
        },
      ]
    : [];
}

/** The checks for a field with a value, by its type. */
const CHECKS: {
  [Type in Field["type"]]?: Check<Extract<Field, { type: Type }>>;
} = {
  text: (field, value, path, label) => [
    ...(field.pattern &&
    typeof value === "string" &&
    !new RegExp(field.pattern).test(value)
      ? [{ path, message: `${label} is not in the expected format` }]
      : []),
    ...maxLengthErrors(field, value, path, label),
  ],
  textarea: maxLengthErrors,
  number: (field, value, path, label) => {
    if (typeof value !== "number") return [];
    const errors: ValidationError[] = [];
    if (field.min !== undefined && value < field.min)
      errors.push({ path, message: `${label} must be at least ${field.min}` });
    if (field.max !== undefined && value > field.max)
      errors.push({ path, message: `${label} must be at most ${field.max}` });
    return errors;
  },
  object: (field, value, path) =>
    value && typeof value === "object"
      ? validate(field.fields, value as Record<string, unknown>, path)
      : [],
  tree: (field, value, path) =>
    Array.isArray(value) ? treeErrors(field, value, path) : [],
  array: (field, value, path, label) =>
    Array.isArray(value) ? arrayErrors(field, value, path, label) : [],
};

/** Each node of a tree, and its children's, checked against the tree's fields. */
function treeErrors(
  field: Extract<Field, { type: "tree" }>,
  nodes: unknown[],
  path: string,
): ValidationError[] {
  const key = field.childrenKey ?? "children";
  return nodes.flatMap((n, i) => {
    if (!n || typeof n !== "object") return [];
    const kids = (n as Record<string, unknown>)[key];
    return [
      ...validate(field.fields, n as Record<string, unknown>, `${path}.${i}`),
      ...(Array.isArray(kids)
        ? treeErrors(field, kids, `${path}.${i}.${key}`)
        : []),
    ];
  });
}

function arrayErrors(
  field: Extract<Field, { type: "array" }>,
  items: unknown[],
  path: string,
  label: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (field.min !== undefined && items.length < field.min)
    errors.push({
      path,
      message: `${label} needs at least ${field.min} items`,
    });
  if (field.max !== undefined && items.length > field.max)
    errors.push({
      path,
      message: `${label} allows at most ${field.max} items`,
    });
  const of = field.of;
  if (of.type === "object") {
    items.forEach((item, i) =>
      errors.push(
        ...validate(of.fields, item as Record<string, unknown>, `${path}.${i}`),
      ),
    );
  }
  return errors;
}

/** Short human summary of an object value, for list item headers. */
export function summarize(value: unknown, field?: Field): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object")
    return objectSummary(value as Record<string, unknown>, field);
  return "";
}

/** An object's item label, title-like field or first text. */
function objectSummary(obj: Record<string, unknown>, field?: Field): string {
  const itemLabel = field?.type === "array" ? field.itemLabel : undefined;
  if (itemLabel && obj[itemLabel] !== undefined) return String(obj[itemLabel]);
  for (const k of ["title", "label", "name", "heading", "id"]) {
    if (typeof obj[k] === "string" && obj[k]) return obj[k] as string;
  }
  const first = Object.values(obj).find((v) => typeof v === "string" && v);
  return first ? String(first) : "";
}

export function isImagePath(p: string): boolean {
  return /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(p);
}

/** CSS declarations (`color: red; font-weight: 600`) as a React style object. */
export function cssToStyle(css: string | undefined): CSSProperties {
  const style: Record<string, string> = {};
  for (const declaration of (css ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (!property || !value) continue;
    // Custom properties keep their name; the rest are camel-cased.
    const key = property.startsWith("--")
      ? property
      : property
          .replace(/^-ms-/, "ms-")
          .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    style[key] = value;
  }
  return style as CSSProperties;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Up to two initials for an avatar, from a name or an email address. */
export function initials(nameOrEmail: string): string {
  const parts = nameOrEmail
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : "";
  return `${first}${last ?? ""}`.toUpperCase();
}

/** A component's props in a line, as its collapsed block shows them. */
export function summarizeProps(props: Record<string, unknown>): string {
  return Object.entries(props)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => summarizeProp(k, v))
    .join(" · ");
}

function summarizeProp(key: string, value: unknown): string {
  if (isRawExpression(value)) return `${key}={…}`;
  if (typeof value === "string")
    return `${key}="${value.length > 40 ? `${value.slice(0, 40)}…` : value}"`;
  if (Array.isArray(value))
    return `${key}: ${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return `${key}: ${summarize(value) || "{…}"}`;
  return `${key}=${String(value)}`;
}

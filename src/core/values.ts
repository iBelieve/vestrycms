/**
 * Value transforms shared by the server and the control panel: asset path
 * normalisation and automatic fields. Pure functions, no I/O.
 */
import type { CollectionConfig, Field, Schema } from "../config/types.js";
import {
  basename,
  dateFromSlug,
  dirname,
  isPlainDate,
  joinPath,
  normalizePath,
  relativePath,
  resolveRelative,
} from "./paths.js";

export { dateFromSlug, slugWithDate, slugWithoutDate } from "./paths.js";

export function walkValues(
  schema: Schema,
  data: Record<string, unknown>,
  fn: (field: Field, value: unknown) => unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const [key, field] of Object.entries(schema)) {
    if (!(key in out)) continue;
    out[key] = walkValue(field, out[key], fn);
  }
  return out;
}

function walkValue(
  field: Field,
  value: unknown,
  fn: (field: Field, value: unknown) => unknown,
): unknown {
  if (
    field.type === "object" &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return walkValues(field.fields, value as Record<string, unknown>, fn);
  }
  if (field.type === "array" && Array.isArray(value)) {
    return value.map((v) => walkValue(field.of, v, fn));
  }
  if (field.type === "tree" && Array.isArray(value)) {
    const key = field.childrenKey ?? "children";
    const walkNodes = (nodes: unknown[]): unknown[] =>
      nodes.map((n) => {
        if (!n || typeof n !== "object") return n;
        const node = walkValues(field.fields, n as Record<string, unknown>, fn);
        const children = (n as Record<string, unknown>)[key];
        if (Array.isArray(children)) node[key] = walkNodes(children);
        return node;
      });
    return walkNodes(value);
  }
  return fn(field, value);
}

/** Field types whose values are too large, or too structured, for a list. */
const HEAVY_FIELDS = new Set<Field["type"]>([
  "array",
  "object",
  "tree",
  "markdown",
  "code",
  "json",
]);

/** Whether a field is, or contains, a reference to another entry. */
function holdsReference(field: Field): boolean {
  if (field.type === "reference") return true;
  if (field.type === "object" || field.type === "tree")
    return Object.values(field.fields).some(holdsReference);
  if (field.type === "array") return holdsReference(field.of);
  return false;
}

/**
 * The part of an entry's data that listings carry. Entry lists (and the
 * build-time index, which is bundled into the server) only need what a list
 * can show, sort or search by, so nested and long-form fields are left out
 * unless the collection's title, status, sort, columns, search fields, slug
 * source or preview URL name them, or they hold references to other entries
 * (which a rename has to find). Open the entry for the full data.
 */
export function summaryData(
  col: CollectionConfig,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const named = new Set<string>([
    col.titleField ?? "title",
    col.idField ?? "id",
    "subtitle",
  ]);
  const add = (key: string | undefined) => {
    if (key) named.add(key);
  };
  add(col.sort?.field);
  add(col.status?.field);
  add(col.slug?.from);
  for (const column of col.columns ?? [])
    add(typeof column === "string" ? column : column.field);
  for (const key of col.searchFields ?? []) add(key);
  for (const template of [col.previewUrl, col.slug?.template])
    for (const match of template?.matchAll(/\{([\w]+)/g) ?? []) add(match[1]);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!named.has(key)) {
      const field = col.schema[key];
      const heavy = field
        ? HEAVY_FIELDS.has(field.type) && !holdsReference(field)
        : value !== null &&
          typeof value === "object" &&
          !(value instanceof Date);
      if (heavy) continue;
    }
    out[key] = value;
  }
  return out;
}

export type AssetField = Extract<Field, { type: "image" | "file" }>;
export type AssetLike = { directory: string; storeAs?: AssetField["storeAs"] };

export function defaultStorage(
  field: AssetLike,
): NonNullable<AssetField["storeAs"]> {
  if (field.storeAs) return field.storeAs;
  return normalizePath(field.directory).startsWith("public/")
    ? "public"
    : "relative";
}

/** Stored reference (relative path, bare filename, public URL) → repository path. */
export function assetToRepoPath(
  field: AssetLike,
  value: string,
  filePath: string,
): string {
  const dir = normalizePath(field.directory);
  if (/^https?:\/\//.test(value)) return value;
  if (value.startsWith("/")) {
    if (dir.startsWith("public/")) {
      const publicRoot = dir.slice("public/".length);
      const rel = value.replace(/^\//, "");
      return rel.startsWith(publicRoot)
        ? `public/${rel}`
        : joinPath(dir, basename(rel));
    }
    return normalizePath(value);
  }
  if (value.startsWith(".")) return resolveRelative(dirname(filePath), value);
  if (value.startsWith(dir)) return normalizePath(value);
  if (
    value.includes("/") &&
    (value.startsWith("src/") || value.startsWith("public/"))
  ) {
    return normalizePath(value);
  }
  return joinPath(dir, value);
}

/** Repository path → the reference written into the content file. */
export function repoPathToAsset(
  field: AssetLike,
  repoPath: string,
  filePath: string,
): string {
  if (/^https?:\/\//.test(repoPath)) return repoPath;
  const n = normalizePath(repoPath);
  switch (defaultStorage(field)) {
    case "filename":
      return basename(n);
    case "public":
      return n.startsWith("public/")
        ? `/${n.slice("public/".length)}`
        : `/${n}`;
    case "repo":
      return n;
    case "relative":
    default:
      return relativePath(dirname(filePath), n);
  }
}

/** Convert stored values to the editor's canonical representation (repo paths, ISO strings). */
export function toEditorValues(
  schema: Schema,
  data: Record<string, unknown>,
  filePath: string,
): Record<string, unknown> {
  return walkValues(schema, data, (field, value) => {
    if (
      (field.type === "image" || field.type === "file") &&
      typeof value === "string" &&
      value
    ) {
      return assetToRepoPath(field, value, filePath);
    }
    if (field.type === "date" && value instanceof Date)
      return value.toISOString().slice(0, 10);
    if (field.type === "datetime" && value instanceof Date)
      return value.toISOString();
    return value;
  });
}

/** Key of the date field kept in the file name (`storeIn: "filename"`), if any. */
export function filenameDateKey(schema: Schema): string | null {
  for (const [key, field] of Object.entries(schema)) {
    if (field.type === "date" && field.storeIn === "filename") return key;
  }
  return null;
}

/** Fill the file-name date field of an entry's editor values from its slug. */
export function withFilenameDate(
  schema: Schema,
  data: Record<string, unknown>,
  slug: string,
): Record<string, unknown> {
  const key = filenameDateKey(schema);
  if (!key) return data;
  const date = dateFromSlug(slug);
  return date ? { ...data, [key]: date } : data;
}

export function toStoredValues(
  schema: Schema,
  data: Record<string, unknown>,
  filePath: string,
): Record<string, unknown> {
  const stored = storedFieldValues(schema, data, filePath);
  // A date kept in the file name is not written to the file as well. A
  // value that is not a plain date never reached the name (`slugWithDate`
  // leaves the slug alone), so it stays in the file rather than being lost.
  const filenameDate = filenameDateKey(schema);
  if (filenameDate) {
    const value = stored[filenameDate];
    if (value == null || value === "" || isPlainDate(value))
      delete stored[filenameDate];
  }
  return stored;
}

function storedFieldValues(
  schema: Schema,
  data: Record<string, unknown>,
  filePath: string,
): Record<string, unknown> {
  return walkValues(schema, data, (field, value) => {
    if (
      (field.type === "image" || field.type === "file") &&
      typeof value === "string" &&
      value
    ) {
      return repoPathToAsset(field, value, filePath);
    }
    return value;
  });
}

export function applyAutoFields(
  schema: Schema,
  data: Record<string, unknown>,
  now = new Date(),
): Record<string, unknown> {
  const out = { ...data };
  for (const [key, field] of Object.entries(schema)) {
    if (field.type === "datetime" && field.autoUpdate) {
      out[key] =
        field.storage === "local"
          ? now.toISOString().slice(0, 16)
          : now.toISOString();
    }
  }
  return out;
}

/** Whether a schema has a reference field (at any depth) to `collection`. */
export function referencesCollection(
  schema: Schema,
  collection: string,
): boolean {
  const refers = (field: Field): boolean => {
    if (field.type === "reference") return field.collection === collection;
    if (field.type === "object")
      return Object.values(field.fields).some(refers);
    if (field.type === "array") return refers(field.of);
    if (field.type === "tree") return Object.values(field.fields).some(refers);
    return false;
  };
  return Object.values(schema).some(refers);
}

/**
 * Point every reference to entry `from` of `collection` at `to` instead.
 * Returns the new data, or null when nothing referred to it.
 */
export function rewriteReferences(
  schema: Schema,
  data: Record<string, unknown>,
  collection: string,
  from: string,
  to: string,
): Record<string, unknown> | null {
  let changed = false;
  const next = walkValues(schema, data, (field, value) => {
    if (
      field.type === "reference" &&
      field.collection === collection &&
      value === from
    ) {
      changed = true;
      return to;
    }
    return value;
  });
  return changed ? next : null;
}

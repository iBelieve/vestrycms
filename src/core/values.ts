/**
 * Value transforms shared by the server and the control panel: asset path
 * normalisation, automatic fields and the order of sort values. Pure
 * functions, no I/O.
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
  const named = namedFields(col);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!named.has(key) && isHeavy(col.schema[key], value)) continue;
    out[key] = value;
  }
  return out;
}

/** The fields a collection's settings name, which listings always carry. */
function namedFields(col: CollectionConfig): Set<string> {
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
  return named;
}

/**
 * Whether a value is nested or long-form, so left out of listings: by its
 * field's type, or for data the schema does not describe, by its shape.
 */
function isHeavy(field: Field | undefined, value: unknown): boolean {
  if (field) return HEAVY_FIELDS.has(field.type) && !holdsReference(field);
  return (
    value !== null && typeof value === "object" && !(value instanceof Date)
  );
}

export type AssetField = Extract<Field, { type: "image" | "file" }>;
export type AssetLike = { directory: string; storeAs?: AssetField["storeAs"] };

/** `public/` itself, or a folder in it (a normalized path). */
const isPublicDir = (dir: string) =>
  dir === "public" || dir.startsWith("public/");

/** A URL of another site, protocol-relative (`//cdn…`) included. */
export const isRemoteUrl = (value: string) => /^(?:https?:)?\/\//.test(value);

export function defaultStorage(
  field: AssetLike,
): NonNullable<AssetField["storeAs"]> {
  if (field.storeAs) return field.storeAs;
  return isPublicDir(normalizePath(field.directory)) ? "public" : "relative";
}

/**
 * A value that starts with `/`: the URL of a file in `public/`, whichever
 * folder it is in, or (outside a `public/` directory) a repository path
 * written with a leading slash.
 */
function rootedToRepoPath(dir: string, value: string): string {
  const rel = normalizePath(value);
  if (rel.startsWith(`${dir}/`)) return rel;
  if (
    !isPublicDir(dir) &&
    (rel.startsWith("src/") || rel.startsWith("public/"))
  )
    return rel;
  return `public/${rel}`;
}

/** Stored reference (relative path, bare filename, public URL) → repository path. */
export function assetToRepoPath(
  field: AssetLike,
  value: string,
  filePath: string,
): string {
  const dir = normalizePath(field.directory);
  if (isRemoteUrl(value)) return value;
  if (value.startsWith("/")) return rootedToRepoPath(dir, value);
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
  if (isRemoteUrl(repoPath)) return repoPath;
  const n = normalizePath(repoPath);
  const url = n.startsWith("public/")
    ? `/${n.slice("public/".length)}`
    : `/${n}`;
  switch (defaultStorage(field)) {
    case "filename": {
      // A file name names a file in the field's directory; any other file
      // (a URL read from the file, say) keeps a form that still names it.
      const dir = normalizePath(field.directory);
      if (!dir || n.startsWith(`${dir}/`)) return basename(n);
      return n.startsWith("public/") ? url : n;
    }
    case "public":
      return url;
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
    if (isAssetValue(field, value))
      return assetToRepoPath(field as AssetField, value, filePath);
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
  const stored = assetsToStored(schema, data, filePath);
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

/** An image or file field's value, when it names a file. */
function isAssetValue(field: Field, value: unknown): value is string {
  return (
    (field.type === "image" || field.type === "file") &&
    typeof value === "string" &&
    value !== ""
  );
}

/** Key of a repository path, as a field reads it, in a `written` map. */
const writtenKey = (field: AssetLike, repoPath: string) =>
  JSON.stringify([normalizePath(field.directory), field.storeAs, repoPath]);

/**
 * The image and file values in `data` (which may nest), from the form the
 * content file holds them in to repository paths, the form the editor
 * works with. `filePath` is the file they are written in. Given `written`,
 * each value is remembered there as the file wrote it, for
 * `assetsToStored`.
 */
export function assetsToRepoPaths(
  schema: Schema,
  data: Record<string, unknown>,
  filePath: string,
  written?: Map<string, string>,
): Record<string, unknown> {
  return walkValues(schema, data, (field, value) => {
    if (!isAssetValue(field, value)) return value;
    const repoPath = assetToRepoPath(field as AssetField, value, filePath);
    written?.set(writtenKey(field as AssetField, repoPath), value);
    return repoPath;
  });
}

/**
 * The reverse of `assetsToRepoPaths`: repository paths in each field's
 * `storeAs` form. A value `written` remembers is kept as the file wrote it
 * while it still names the same file, so that saving a document does not
 * rewrite references nobody changed (`assetToRepoPath` reads some forms,
 * such as a URL outside the field's directory, in a way that would not
 * write them back as they were).
 */
export function assetsToStored(
  schema: Schema,
  data: Record<string, unknown>,
  filePath: string,
  written?: Map<string, string>,
): Record<string, unknown> {
  return walkValues(schema, data, (field, value) => {
    if (!isAssetValue(field, value)) return value;
    const asset = field as AssetField;
    const original = written?.get(writtenKey(asset, value));
    return original !== undefined &&
      assetToRepoPath(asset, original, filePath) === value
      ? original
      : repoPathToAsset(asset, value, filePath);
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The editor's calendar date at `now`, `YYYY-MM-DD`, in its own time zone. */
export function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The editor's wall-clock time at `now`, `YYYY-MM-DDTHH:mm`, without a zone. */
export function localDateTime(now: Date): string {
  return `${localDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * How a datetime field's value is stored. An `autoUpdate` field has always
 * defaulted to a full ISO instant; every other one to wall-clock time,
 * which is what its input writes.
 */
export function datetimeStorage(field: {
  storage?: "local" | "iso";
  autoUpdate?: boolean;
}): "local" | "iso" {
  return field.storage ?? (field.autoUpdate ? "iso" : "local");
}

/** The time `now` as a datetime field stores it. */
export function datetimeValue(
  field: { storage?: "local" | "iso"; autoUpdate?: boolean },
  now: Date,
): string {
  return datetimeStorage(field) === "local"
    ? localDateTime(now)
    : now.toISOString();
}

/**
 * Sets each `autoUpdate` datetime field to `now`. A wall-clock value is the
 * editor's own time, which the server cannot know (a Worker runs in UTC), so
 * with `keepWallClock` one the control panel just stamped is kept: one
 * within a time zone of `now`. An older one (a caller sending back what it
 * loaded) is restamped.
 */
export function applyAutoFields(
  schema: Schema,
  data: Record<string, unknown>,
  now = new Date(),
  { keepWallClock = false }: { keepWallClock?: boolean } = {},
): Record<string, unknown> {
  const out = { ...data };
  for (const [key, field] of Object.entries(schema)) {
    if (field.type !== "datetime" || !field.autoUpdate) continue;
    const wallClock = datetimeStorage(field) === "local";
    if (keepWallClock && wallClock && isCurrentWallClock(out[key], now))
      continue;
    out[key] = datetimeValue(field, now);
  }
  return out;
}

/** Time zones are within 14 hours of UTC; a little more for a slow save. */
const WALL_CLOCK_SPREAD = 15 * 60 * 60 * 1000;

/** A wall-clock time that is `now` somewhere in the world. */
function isCurrentWallClock(value: unknown, now: Date): boolean {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const asUtc = Date.parse(`${value}Z`);
  return Math.abs(asUtc - now.getTime()) <= WALL_CLOCK_SPREAD;
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
/**
 * Whether a reference names entry `slug`. A list's ids may be numbers in
 * its file (`id: 1`), and references to them too.
 */
const sameId = (value: unknown, slug: string) =>
  value === slug || (typeof value === "number" && String(value) === slug);

/** An id that reads back as the same number (not `007` or `1e3`). */
const isNumberId = (id: string) => id !== "" && String(Number(id)) === id;

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
      sameId(value, from)
    ) {
      changed = true;
      // A reference to a number id stays a number when the new id is one.
      return typeof value === "number" && isNumberId(to) ? Number(to) : to;
    }
    return value;
  });
  return changed ? next : null;
}

/**
 * Compares two values of a sort field in direction `dir` (1 or -1): numbers
 * and dates as such, the rest as text, and missing values (none, "", or a
 * list of nothing else) last whatever the direction. A field that mixes
 * numbers and text (`123` and `123a`) puts the numbers first.
 */
export function compareSortValues(a: unknown, b: unknown, dir: number): number {
  const am = isMissing(a);
  const bm = isMissing(b);
  if (am || bm) return am === bm ? 0 : am ? 1 : -1;
  const av = sortable(a);
  const bv = sortable(b);
  // `<` between a number and text compares NaN, which would make the order
  // depend on where the entries started.
  if (typeof av !== typeof bv) return typeof av === "number" ? -dir : dir;
  return av < bv ? -dir : av > bv ? dir : 0;
}

/** What a list shows as "—": no value, "", or a list of only those. */
const isMissing = (v: unknown): boolean =>
  Array.isArray(v)
    ? v.every(isMissing)
    : v === undefined || v === null || v === "";

function sortable(v: unknown): string | number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return String(v ?? "");
}

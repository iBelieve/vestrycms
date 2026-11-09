/**
 * Value transforms shared by the server and the control panel: asset path
 * normalisation and automatic fields. Pure functions, no I/O.
 */
import type { Field, Schema } from "../config/types.js";
import {
  basename,
  dirname,
  joinPath,
  normalizePath,
  relativePath,
  resolveRelative,
} from "./paths.js";

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

export function toStoredValues(
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

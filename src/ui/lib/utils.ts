import type { CSSProperties } from "react";
import type { Field, Schema } from "../../config/types.js";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
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

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/** Default value for a field (used when creating entries / array items). */
export function defaultValue(field: Field): unknown {
  switch (field.type) {
    case "text":
    case "textarea":
    case "slug":
    case "color":
    case "image":
    case "file":
    case "reference":
    case "markdown":
    case "code":
      return field.default ?? "";
    case "number":
      return field.default ?? null;
    case "boolean":
      return field.default ?? false;
    case "date":
      return field.default === "now"
        ? new Date().toISOString().slice(0, 10)
        : (field.default ?? "");
    case "datetime":
      if (field.default === "now") {
        return field.storage === "local"
          ? new Date().toISOString().slice(0, 16)
          : new Date().toISOString();
      }
      return field.default ?? "";
    case "select":
      return (
        field.default ??
        (field.clearable ? "" : (field.options[0]?.value ?? ""))
      );
    case "multiselect":
      return field.default ?? [];
    case "object":
      return defaultValues(field.fields);
    case "array":
      return [];
    case "json":
      return field.default ?? null;
    case "crop":
    case "focalPoint":
      return undefined;
    case "tree":
      return [];
  }
}

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
    const empty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (field.required && empty) {
      errors.push({ path, message: `${label} is required` });
      continue;
    }
    if (empty) continue;
    if (field.type === "text" && field.pattern && typeof value === "string") {
      if (!new RegExp(field.pattern).test(value))
        errors.push({
          path,
          message: `${label} is not in the expected format`,
        });
    }
    if (
      (field.type === "text" || field.type === "textarea") &&
      field.maxLength &&
      typeof value === "string" &&
      value.length > field.maxLength
    ) {
      errors.push({
        path,
        message: `${label} must be at most ${field.maxLength} characters`,
      });
    }
    if (field.type === "number" && typeof value === "number") {
      if (field.min !== undefined && value < field.min)
        errors.push({
          path,
          message: `${label} must be at least ${field.min}`,
        });
      if (field.max !== undefined && value > field.max)
        errors.push({ path, message: `${label} must be at most ${field.max}` });
    }
    if (field.type === "object" && value && typeof value === "object") {
      errors.push(
        ...validate(field.fields, value as Record<string, unknown>, path),
      );
    }
    if (field.type === "tree" && Array.isArray(value)) {
      const key = field.childrenKey ?? "children";
      const walk = (nodes: unknown[], prefix: string) =>
        nodes.forEach((n, i) => {
          if (!n || typeof n !== "object") return;
          errors.push(
            ...validate(
              field.fields,
              n as Record<string, unknown>,
              `${prefix}.${i}`,
            ),
          );
          const kids = (n as Record<string, unknown>)[key];
          if (Array.isArray(kids)) walk(kids, `${prefix}.${i}.${key}`);
        });
      walk(value, path);
    }
    if (field.type === "array" && Array.isArray(value)) {
      if (field.min !== undefined && value.length < field.min)
        errors.push({
          path,
          message: `${label} needs at least ${field.min} items`,
        });
      if (field.max !== undefined && value.length > field.max)
        errors.push({
          path,
          message: `${label} allows at most ${field.max} items`,
        });
      if (field.of.type === "object") {
        value.forEach((item, i) =>
          errors.push(
            ...validate(
              (field.of as { fields: Schema }).fields,
              item as Record<string, unknown>,
              `${path}.${i}`,
            ),
          ),
        );
      }
    }
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
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (
      field?.type === "array" &&
      field.itemLabel &&
      obj[field.itemLabel] !== undefined
    )
      return String(obj[field.itemLabel]);
    for (const k of ["title", "label", "name", "heading", "id"]) {
      if (typeof obj[k] === "string" && obj[k]) return obj[k] as string;
    }
    const first = Object.values(obj).find((v) => typeof v === "string" && v);
    return first ? String(first) : "";
  }
  return "";
}

export function isImagePath(p: string): boolean {
  return /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(p);
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

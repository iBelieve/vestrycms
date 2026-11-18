import type {
  CollectionConfig,
  EntryFormat,
  SingletonConfig,
} from "../config/types.js";

export function normalizePath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .replace(/^\//, "")
    .replace(/\/$/, "");
}

export function extname(p: string): string {
  const i = p.lastIndexOf(".");
  const s = p.lastIndexOf("/");
  return i > s ? p.slice(i + 1).toLowerCase() : "";
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

/** Resolve `../x` style segments against a directory (repo-relative). */
export function resolveRelative(fromDir: string, rel: string): string {
  const out = normalizePath(fromDir).split("/").filter(Boolean);
  for (const seg of normalizePath(rel).split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== "." && seg !== "") out.push(seg);
  }
  return out.join("/");
}

/** Relative path from one directory to a file (repo-relative, posix). */
export function relativePath(fromDir: string, toFile: string): string {
  const a = normalizePath(fromDir).split("/").filter(Boolean);
  const b = normalizePath(toFile).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ups = a.slice(i).map(() => "..");
  const rest = b.slice(i);
  const parts = [...ups, ...rest];
  const rel = parts.join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export function formatFromPath(p: string): EntryFormat {
  const ext = extname(p);
  if (ext === "mdx") return "mdx";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (ext === "json") return "json";
  throw new Error(`Cannot infer content format from path "${p}"`);
}

export interface PathPattern {
  /** Literal path prefix before the wildcard, e.g. `src/content/sermons/`. */
  prefix: string;
  /** Literal suffix after the wildcard, e.g. `.mdx`. */
  suffix: string;
  /** Whether the wildcard was `**` (slugs may contain `/`). */
  deep: boolean;
  /** No wildcard: a single file containing all entries. */
  single: boolean;
  /** Directory that holds the entries (prefix without trailing slash). */
  directory: string;
}

export function parsePathPattern(pattern: string): PathPattern {
  const p = normalizePath(pattern);
  const deepIdx = p.indexOf("**");
  const starIdx = p.indexOf("*");
  if (starIdx === -1) {
    return {
      prefix: p,
      suffix: "",
      deep: false,
      single: true,
      directory: dirname(p),
    };
  }
  const deep = deepIdx !== -1;
  const prefix = p.slice(0, starIdx);
  const after = deep ? p.slice(deepIdx + 2) : p.slice(starIdx + 1);
  // `** /index.md` → suffix `/index.md`; `*.mdx` → suffix `.mdx`
  if (after.includes("*")) {
    throw new Error(`Path pattern "${pattern}" may contain only one wildcard`);
  }
  return {
    prefix,
    suffix: after,
    deep,
    single: false,
    directory: prefix.replace(/\/$/, ""),
  };
}

export function entryPath(pattern: PathPattern, slug: string): string {
  if (pattern.single) return pattern.prefix;
  return `${pattern.prefix}${slug}${pattern.suffix}`;
}

/** Returns the slug for a file path if it matches the pattern, else null. */
export function slugFromPath(
  pattern: PathPattern,
  path: string,
): string | null {
  const p = normalizePath(path);
  if (pattern.single) return null;
  if (!p.startsWith(pattern.prefix) || !p.endsWith(pattern.suffix)) return null;
  const slug = p.slice(pattern.prefix.length, p.length - pattern.suffix.length);
  if (!slug) return null;
  if (!pattern.deep && slug.includes("/")) return null;
  if (slug.startsWith("_") || slug.split("/").some((s) => s.startsWith("_"))) {
    // Astro ignores underscore-prefixed content files.
    return null;
  }
  return slug;
}

export function collectionFormat(
  c: CollectionConfig | SingletonConfig,
): EntryFormat {
  return c.format ?? formatFromPath(c.path);
}

/**
 * Whether entries can be created, deleted and renamed (`editable`, true
 * unless set to `false`).
 */
export function isEditable(c: CollectionConfig): boolean {
  return c.editable !== false;
}

/**
 * Whether `slug` is one of the collection's `reservedSlugs`, ignoring case:
 * `Index.mdx` is the same file as `index.mdx` on a case-insensitive disk,
 * and Astro lowercases content ids.
 */
export function isReservedSlug(c: CollectionConfig, slug: string): boolean {
  const s = slug.toLowerCase();
  return c.reservedSlugs?.some((r) => r.toLowerCase() === s) ?? false;
}

/**
 * Why no entry may be put at `slug`, if none may: it is reserved, or, in a
 * collection with folders, it is under a reserved slug (`sermons/index`
 * under `sermons`), whose route the entry would share or sit below. Case is
 * ignored, as in `isReservedSlug`.
 */
export function reservedSlugProblem(
  c: CollectionConfig,
  slug: string,
): string | null {
  if (isReservedSlug(c, slug)) return `"${slug}" is a reserved slug`;
  // Only a `**` path has folders; a list's ids are not paths.
  if (!parsePathPattern(c.path).deep) return null;
  const s = slug.toLowerCase();
  const parent = c.reservedSlugs?.find((r) =>
    s.startsWith(`${r.toLowerCase()}/`),
  );
  return parent === undefined
    ? null
    : `"${slug}" is under the reserved slug "${parent}"`;
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

/**
 * An uploaded file's name as it is stored: no directory, ASCII letters,
 * digits, `.`, `_` and `-`, lower case. The control panel names deferred
 * uploads with it too, so both paths agree.
 */
export function safeFileName(name: string): string {
  const base = basename(name.replace(/\\/g, "/"));
  const ext = extname(base);
  const stem = base.slice(0, ext ? base.length - ext.length - 1 : undefined);
  const cleanStem = stem
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return ext ? `${cleanStem || "file"}.${ext}` : cleanStem || "file";
}

const SLUG_DATE = /^(\d{4}-\d{2}-\d{2})-(?=.)/;

/** Split a slug into its directory part (with trailing slash) and file name. */
function splitSlug(slug: string): [string, string] {
  const i = slug.lastIndexOf("/");
  return [slug.slice(0, i + 1), slug.slice(i + 1)];
}

/** The `YYYY-MM-DD` a slug's file name starts with, or null. */
export function dateFromSlug(slug: string): string | null {
  return SLUG_DATE.exec(splitSlug(slug)[1])?.[1] ?? null;
}

/** The slug without its file name's date prefix, if it has one. */
export function slugWithoutDate(slug: string): string {
  const [dir, name] = splitSlug(slug);
  return `${dir}${name.replace(SLUG_DATE, "")}`;
}

/**
 * The slug with `date` as its file name's date prefix, replacing the one it
 * has or adding one. Anything that is not a `YYYY-MM-DD` date leaves the
 * slug as it is.
 */
export function slugWithDate(slug: string, date: unknown): string {
  if (!isPlainDate(date)) return slug;
  const [dir, name] = splitSlug(slug);
  return `${dir}${date}-${name.replace(SLUG_DATE, "")}`;
}

/** Whether a value is a date as a file name holds it, `YYYY-MM-DD`. */
export function isPlainDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * A date as its `[year, month, day]`, zero-padded, or null if `value` isn't
 * one. A slug with a date prefix (`2026-11-13-title`) counts.
 */
function dateParts(value: unknown): [string, string, string] | null {
  // A string is read as written, whatever time zone it names; a Date (as
  // YAML parses `2026-11-13`) is midnight UTC on its day.
  const text =
    value instanceof Date
      ? Number.isNaN(value.getTime())
        ? ""
        : value.toISOString()
      : typeof value === "string"
        ? value
        : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(text);
  return match ? [match[1], match[2], match[3]] : null;
}

/**
 * Filters for template placeholders, written `{field|filter}`. Each takes the
 * field's value and returns the text to insert.
 */
export const TEMPLATE_FILTERS: Record<string, (value: unknown) => string> = {
  /** Four-digit year of a date, `2026`. */
  year: (value) => dateParts(value)?.[0] ?? "",
  /** Zero-padded month of a date, `01`–`12`. */
  month: (value) => dateParts(value)?.[1] ?? "",
  /** Zero-padded day of the month of a date, `01`–`31`. */
  day: (value) => dateParts(value)?.[2] ?? "",
  /**
   * The value without the `YYYY-MM-DD-` its file name starts with, for
   * collections whose file names carry the date but whose URLs do not:
   * `2026-03-01-title` and `notes/2026-03-01-title` lose the date.
   */
  nodate: (value) =>
    value instanceof Date ? "" : slugWithoutDate(String(value)),
};

const PLACEHOLDER = /\{([\w.]+)(?:\s*\|\s*(\w+)\s*)?\}/g;
/** Anything written as a filter, to report the ones PLACEHOLDER would not fill. */
const FILTERED = /\{[\w.]+\s*\|([^{}]*)\}/g;

/**
 * Fill `{field}` and `{field|filter}` placeholders from a record. With
 * `slug`, each inserted value is slugified; the template's own text (a `/`
 * between placeholders, say) is kept as written.
 */
export function fillTemplate(
  template: string,
  values: Record<string, unknown>,
  opts: { slug?: boolean } = {},
): string {
  return template.replace(PLACEHOLDER, (_, key: string, filter?: string) => {
    const raw = key.split(".").reduce<unknown>((acc, k) => {
      if (acc && typeof acc === "object")
        return (acc as Record<string, unknown>)[k];
      return undefined;
    }, values);
    if (raw === undefined || raw === null) return "";
    // An unknown filter is reported when the config is validated; here the
    // value goes in unfiltered.
    const apply =
      filter && Object.hasOwn(TEMPLATE_FILTERS, filter)
        ? TEMPLATE_FILTERS[filter]
        : undefined;
    let s = apply
      ? apply(raw)
      : raw instanceof Date
        ? raw.toISOString().slice(0, 10)
        : String(raw);
    if (opts.slug) s = slugify(s);
    return s;
  });
}

/** Why a template is unusable (it names an unknown filter), or undefined when it is fine. */
export function templateError(template: string): string | undefined {
  for (const [placeholder, filter] of template.matchAll(FILTERED)) {
    const name = filter.trim();
    if (!Object.hasOwn(TEMPLATE_FILTERS, name))
      return `unknown filter "${name}" in "${placeholder}" (filters: ${Object.keys(TEMPLATE_FILTERS).join(", ")})`;
  }
  return undefined;
}

const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function isSafeSlug(slug: string): boolean {
  return SAFE_SLUG.test(slug) && !slug.includes("..");
}

export function isSafeRepoPath(path: string): boolean {
  const p = normalizePath(path);
  return (
    p.length > 0 &&
    !p.split("/").some((s) => s === ".." || s === "" || s === ".git") &&
    !p.startsWith("/")
  );
}

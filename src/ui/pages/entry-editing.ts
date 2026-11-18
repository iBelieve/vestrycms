/**
 * The entry editor's logic, apart from React: where an entry is saved, what
 * its slug box shows, how its body's images resolve, what a save sends and
 * which card each field goes in.
 */
import type {
  BodyConfig,
  CollectionConfig,
  EditorSection,
  Field,
  SingletonConfig,
  VestryConfig,
} from "../../config/types.js";
import { serializeEntry } from "../../core/entries.js";
import {
  collectionFormat,
  dirname,
  entryPath,
  fillTemplate,
  isEditable,
  isReservedSlug,
  reservedSlugProblem,
  isSafeSlug,
  normalizePath,
  relativePath,
  resolveRelative,
  slugify,
  type PathPattern,
} from "../../core/paths.js";
import {
  applyAutoFields,
  assetToRepoPath,
  repoPathToAsset,
  rewriteReferences,
  slugWithDate,
  slugWithoutDate,
  toStoredValues,
} from "../../core/values.js";
import { ApiError, type SaveEntryInput, type ApiClient } from "../api.js";
import type { PendingUpload } from "../components/AssetPicker.js";
import type { EditorEnv } from "../components/editor/EditorContext.js";
import { formatEntry } from "../lib/format.js";

export type Kind = "collection" | "singleton";

/**
 * The slug the entry will be saved under: what was typed, else the current
 * one, else (for a new entry) one derived from its fields. A date kept in
 * the file name is always its prefix, so changing that date changes the
 * slug. An entry of a list kept in one file goes by its id field instead.
 */
export function effectiveSlug({
  collection,
  pattern,
  slug,
  typed,
  isNew,
  data,
  dateKey,
}: {
  collection: CollectionConfig | null;
  pattern: PathPattern;
  slug: string | null;
  /** What is typed in the slug box. */
  typed: string;
  isNew: boolean;
  data: Record<string, unknown>;
  /** The field whose date the file name starts with, if any. */
  dateKey: string | null;
}): string {
  if (!collection) return slug ?? "";
  // A list entry's slug is its id field, so changing that renames it.
  if (pattern.single)
    return isNew ? "" : listId(collection, data) || (slug ?? "");
  const base = typed || (isNew ? derivedSlug(collection, data) : (slug ?? ""));
  if (!dateKey) return base;
  return slugWithDate(slugWithoutDate(base), data[dateKey]);
}

/** The id a list entry's form holds. */
function listId(
  collection: CollectionConfig,
  data: Record<string, unknown>,
): string {
  const id = data[collection.idField ?? "id"];
  return id === undefined || id === null ? "" : String(id);
}

/** A new entry's slug, from its collection's template or title field. */
function derivedSlug(
  collection: CollectionConfig,
  data: Record<string, unknown>,
): string {
  const template = collection.slug?.template;
  if (template) return fillTemplate(template, data, { slug: true });
  const from = collection.slug?.from ?? collection.titleField ?? "title";
  return slugify(String(data[from] ?? ""));
}

/**
 * What the slug box shows (the slug, less a date held by the date field),
 * and the date prefix shown, fixed, in front of it.
 */
export function slugBox(
  slug: string,
  typed: string,
  dateKey: string | null,
): { value: string; prefix: string } {
  const value = typed || (dateKey ? slugWithoutDate(slug) : slug);
  const prefix =
    dateKey && slug !== value && !value.includes("/")
      ? slug.slice(0, slug.length - value.length)
      : "";
  return { value, prefix };
}

/**
 * Why an existing entry's slug can't change, if it can't: its collection
 * isn't `editable`, or its slug is reserved.
 */
export function slugFixed(
  collection: CollectionConfig | null,
  slug: string | null,
): string | null {
  if (!collection || slug === null) return null;
  if (!isEditable(collection))
    return "This collection doesn't allow renaming entries.";
  if (isReservedSlug(collection, slug))
    return "This entry's slug is reserved, so it can't be renamed.";
  return null;
}

/**
 * What's wrong with the slug the entry will be saved under, if anything.
 * A reserved slug can't be taken; a fixed one can't change, though a list
 * entry's id or a date kept in the file name can still try to change it.
 */
export function slugError({
  kind,
  collection,
  pattern,
  finalSlug,
  data,
  fixed,
  changing,
}: {
  kind: Kind;
  collection: CollectionConfig | null;
  pattern: PathPattern;
  finalSlug: string;
  /** The entry's form data, whose id field a list entry is saved under. */
  data: Record<string, unknown>;
  /** Why the current slug can't change, if it can't. */
  fixed: string | null;
  /** The entry is new, or saving it renames it. */
  changing: boolean;
}): string | null {
  if (!changing) return slugProblem(kind, pattern, finalSlug);
  if (fixed) return fixed;
  // A new list entry has no slug yet: it takes the id its form holds, or
  // one derived from its fields when it holds none, as the server does.
  const taken =
    collection && pattern.single
      ? listId(collection, data) ||
        finalSlug ||
        (data[collection.idField ?? "id"] == null
          ? derivedSlug(collection, data)
          : "")
      : finalSlug;
  const reserved =
    collection && taken ? reservedSlugProblem(collection, taken) : null;
  return reserved ? `${reserved}.` : slugProblem(kind, pattern, finalSlug);
}

/** Why a collection entry cannot be saved under `slug`, if it cannot. */
function slugProblem(
  kind: Kind,
  pattern: PathPattern | null,
  slug: string,
): string | null {
  if (kind !== "collection" || !pattern || pattern.single || !slug) return null;
  if (!isSafeSlug(slug))
    return "Use letters, numbers, hyphens, dots and underscores.";
  // A `*` path lists only the files directly in its directory.
  if (!pattern.deep && slug.includes("/"))
    return "This collection has no folders, so a slug cannot contain a slash.";
  return null;
}

/** The repository path of the file the entry is saved in. */
export function entryFile(
  kind: Kind,
  col: CollectionConfig | SingletonConfig,
  pattern: PathPattern,
  slug: string,
): string {
  if (kind === "singleton") return normalizePath(col.path);
  if (pattern.single) return pattern.prefix;
  return entryPath(pattern, slug || "new-entry");
}

/**
 * The body editor's environment: the components it may insert, and how
 * image references in the document resolve, relative to the entry's file.
 */
export function bodyEnv({
  body,
  filePath,
  config,
  uploads,
  fileUrl,
}: {
  body: BodyConfig | null;
  filePath: string;
  config: VestryConfig;
  uploads: Record<string, PendingUpload>;
  fileUrl: (path: string) => string;
}): EditorEnv {
  const images = body?.images;
  const fileDir = dirname(filePath);
  const toRepoPath = (src: string): string | null => {
    if (/^https?:\/\//.test(src)) return null;
    if (images) return assetToRepoPath(images, src, filePath);
    if (src.startsWith("/")) return `public${src}`;
    if (src.startsWith(".")) return resolveRelative(fileDir, src);
    return null;
  };
  const components = Object.fromEntries(
    (body?.components ?? [])
      .map((n) => [n, config.components?.[n]])
      .filter(([, c]) => c),
  ) as EditorEnv["components"];
  return {
    components,
    textStyles: config.textStyles,
    imageDirectory: images?.directory,
    toRepoPath,
    toDocPath: (repoPath) =>
      images
        ? repoPathToAsset(images, repoPath, filePath)
        : relativePath(fileDir, repoPath),
    resolveImage: (src) => {
      const repo = toRepoPath(src);
      if (!repo) return src;
      const pending = uploads[repo];
      return pending ? pending.previewUrl : fileUrl(repo);
    },
  };
}

/**
 * What a save sends: the data (following its own rename), the body, the
 * version it was opened at and the files to upload with it. Whenever the
 * file holds just this entry, the whole file is composed here and
 * formatted with the project's Prettier; single-file collections are
 * merged on the server instead.
 */
export async function saveInput({
  kind,
  col,
  collectionKey,
  pattern,
  filePath,
  state,
  sha,
  isNew,
  rename,
  uploads,
}: {
  kind: Kind;
  col: CollectionConfig | SingletonConfig;
  collectionKey: string;
  pattern: PathPattern;
  filePath: string;
  state: { data: Record<string, unknown>; body: string };
  sha: string | null;
  isNew: boolean;
  /** The slugs of a rename, from and to. */
  rename: { from: string; to: string } | null;
  uploads: Record<string, PendingUpload>;
}): Promise<SaveEntryInput & { data: Record<string, unknown> }> {
  const fields = applyAutoFields(col.schema, state.data);
  // An entry that refers to itself follows its own rename.
  const data =
    (rename &&
      rewriteReferences(
        col.schema,
        fields,
        collectionKey,
        rename.from,
        rename.to,
      )) ||
    fields;
  const input: SaveEntryInput & { data: Record<string, unknown> } = {
    data,
    body: state.body,
    sha: isNew ? undefined : sha,
    uploads: Object.values(uploads).map((u) => ({
      path: u.path,
      base64: u.base64,
    })),
  };
  if (kind === "singleton" || !pattern.single)
    input.raw = await composeFile(col, data, state.body, filePath);
  return input;
}

async function composeFile(
  col: CollectionConfig | SingletonConfig,
  data: Record<string, unknown>,
  body: string,
  filePath: string,
): Promise<string> {
  const format = collectionFormat(col);
  const stored = toStoredValues(col.schema, data, filePath);
  const raw = serializeEntry(format, { data: stored, body });
  try {
    return await formatEntry(raw, filePath, format);
  } catch (e) {
    console.warn("[vestry] formatting failed, saving unformatted", e);
    return raw;
  }
}

/** What to tell the user when a save fails. */
export function saveErrorMessage(e: unknown, datedSlug: boolean): string {
  if (e instanceof ApiError && e.code === "exists") {
    // Another entry has this file name: reloading would not help.
    return `${e.message}. Change the slug${datedSlug ? " or the date" : ""}.`;
  }
  if (e instanceof ApiError && e.status === 409)
    return `${e.message} Reload the page to pick up the latest version.`;
  return (e as Error).message;
}

/** Which of the editor's cards each field goes in. */
export function fieldPlacement(
  col: CollectionConfig | SingletonConfig,
  editable: (key: string) => boolean,
) {
  const sections = col.sections ?? [];
  const sectioned = new Set(
    sections.flatMap((s) => (typeof s === "string" ? [] : s.fields)),
  );
  const unsectioned = (key: string) => !sectioned.has(key) && editable(key);
  const hasVisible = (filter: (key: string, f: Field) => boolean) =>
    Object.entries(col.schema).some(([k, f]) => filter(k, f) && !f.hidden);
  return {
    sections,
    isMain: (key: string, f: Field) => !f.sidebar && unsectioned(key),
    isSidebar: (key: string, f: Field) =>
      Boolean(f.sidebar) && unsectioned(key),
    hasVisible,
    bodyPlaced: sections.includes("body"),
  };
}

/** The fields of a section that the editor shows, and a lone one's label to hide. */
export function sectionFields(
  col: CollectionConfig | SingletonConfig,
  section: Exclude<EditorSection, "body">,
  label: (key: string, field: Field) => string,
): { schema: Record<string, Field>; hideLabels?: string[] } {
  // A lone field named like its section doesn't need a second heading.
  const lone = section.fields.length === 1 ? section.fields[0] : null;
  const loneField = lone ? col.schema[lone] : undefined;
  return {
    schema: Object.fromEntries(
      section.fields
        .filter((k) => col.schema[k])
        .map((k) => [k, col.schema[k]]),
    ),
    hideLabels:
      lone && loneField && label(lone, loneField) === section.label
        ? [lone]
        : undefined,
  };
}

/** Sends a save to the API: a global's, a new entry's or an existing one's. */
export async function sendSave(
  api: ApiClient,
  {
    kind,
    collectionKey,
    slug,
    isNew,
    renaming,
    finalSlug,
  }: {
    kind: Kind;
    collectionKey: string;
    slug: string | null;
    isNew: boolean;
    renaming: boolean;
    finalSlug: string;
  },
  input: SaveEntryInput & { data: Record<string, unknown> },
): Promise<{ sha: string; slug: string; data: Record<string, unknown> }> {
  const { data } = input;
  if (kind === "singleton")
    return {
      ...(await api.saveSingleton(collectionKey, input)),
      slug: collectionKey,
      data,
    };
  if (isNew || renaming) input.slug = finalSlug;
  return isNew
    ? { ...(await api.createEntry(collectionKey, input)), data }
    : { ...(await api.updateEntry(collectionKey, slug!, input)), data };
}

/**
 * How the editor presents an entry: its title (and the text field it is
 * typed in, if any), its publish status and its preview link, and which
 * fields are left to the field cards.
 */
export function entryDisplay({
  kind,
  col,
  data,
  isNew,
  slug,
  siteUrl,
}: {
  kind: Kind;
  col: CollectionConfig | SingletonConfig;
  data: Record<string, unknown>;
  isNew: boolean;
  slug: string;
  siteUrl: string | undefined;
}) {
  const collection = kind === "collection" ? (col as CollectionConfig) : null;
  const titleField = collection ? (collection.titleField ?? "title") : null;
  const titleInput =
    titleField && col.schema[titleField]?.type === "text" ? titleField : null;
  const statusField = collection?.status?.field ?? null;
  const publishedWhen = collection?.status?.publishedWhen ?? true;
  return {
    titleInput,
    titleValue: titleField ? String(data[titleField] ?? "") : col.label,
    statusField,
    publishedWhen,
    isPublished: statusField
      ? Boolean(data[statusField]) === publishedWhen
      : null,
    previewHref:
      col.previewUrl && !isNew
        ? `${siteUrl ?? ""}${fillTemplate(col.previewUrl, { ...data, slug })}`
        : null,
    /** The title and status have controls of their own. */
    editable: (key: string) => key !== statusField && key !== titleInput,
  };
}

/** Publishes or unpublishes the entry; null without a status field. */
export function publishToggle(
  {
    statusField,
    publishedWhen,
  }: { statusField: string | null; publishedWhen: boolean },
  data: Record<string, unknown>,
  setData: (data: Record<string, unknown>) => void,
): ((on: boolean) => void) | null {
  if (!statusField) return null;
  return (on) =>
    setData({ ...data, [statusField]: on ? publishedWhen : !publishedWhen });
}

/** The file a new or renamed entry will be saved in. */
export function slugHint(
  pattern: PathPattern,
  slug: string,
  isNew: boolean,
  renaming: boolean,
): string | null {
  if (pattern.single || !(isNew || renaming)) return null;
  return `${renaming ? "Renames the file to " : ""}${entryPath(pattern, slug || "…")}`;
}

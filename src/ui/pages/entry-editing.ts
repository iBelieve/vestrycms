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
  Schema,
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
  isReadOnly,
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
  isRemoteUrl,
  repoPathToAsset,
  rewriteReferences,
  slugWithDate,
  slugWithoutDate,
  toStoredValues,
  walkValues,
} from "../../core/values.js";
import { ApiError, type SaveEntryInput, type ApiClient } from "../api.js";
import type { PendingUpload } from "../components/AssetPicker.js";
import type { EditorEnv } from "../components/editor/EditorContext.js";
import { pick, rebaseMarkdown } from "../components/editor/rebase.js";
import { formatEntry } from "../lib/format.js";
import { siteHref } from "../lib/utils.js";

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
 * What the slug box shows: the slug, less a date held by the date field
 * (the address under the box shows where that date goes).
 */
export function slugBox(
  slug: string,
  typed: string,
  dateKey: string | null,
): string {
  return typed || (dateKey ? slugWithoutDate(slug) : slug);
}

/**
 * Why an existing entry's slug can't change, if it can't: its collection
 * is read-only or has fixed entries, or its slug is reserved.
 */
export function slugFixed(
  collection: CollectionConfig | null,
  slug: string | null,
): string | null {
  if (!collection || slug === null) return null;
  if (isReadOnly(collection)) return "This collection is read-only.";
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
  const assetUrl = (repo: string) => uploads[repo]?.previewUrl ?? fileUrl(repo);
  const toRepoPath = (src: string): string | null => {
    if (isRemoteUrl(src)) return null;
    if (images) return assetToRepoPath(images, src, filePath);
    if (src.startsWith("/")) return `public${src}`;
    if (src.startsWith(".")) return resolveRelative(fileDir, src);
    return null;
  };
  const components = pick(config.components, body?.components);
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
      return repo ? assetUrl(repo) : src;
    },
    filePath,
    assetUrl,
  };
}

/**
 * An entry's body, and its Markdown fields, moved from the file they were
 * written for to another: relative image references are made relative to
 * the new file (see `rebaseMarkdown`). Frontmatter image fields hold
 * repository paths, and are written for the new file anyway.
 */
function rebaseEntry(
  col: CollectionConfig | SingletonConfig,
  config: VestryConfig,
  state: { data: Record<string, unknown>; body: string },
  from: string,
  to: string,
): { data: Record<string, unknown>; body: string } {
  if (dirname(from) === dirname(to)) return state;
  const format = collectionFormat(col);
  const bodyConfig = col.body === false ? null : col.body;
  const body =
    format === "md" || format === "mdx"
      ? rebaseMarkdown(state.body, {
          format,
          from,
          to,
          components: pick(config.components, bodyConfig?.components),
          allComponents: config.components,
        })
      : state.body;
  const data = walkValues(col.schema, state.data, (field, value) =>
    field.type === "markdown" && typeof value === "string"
      ? rebaseMarkdown(value, {
          format: "mdx",
          from,
          to,
          components: pick(config.components, field.components),
          allComponents: config.components,
        })
      : value,
  );
  return { data, body };
}

/**
 * The body and data a draft changes, moved like `rebaseEntry`; what it
 * leaves alone stays out. Data that is the save's own (`saved`, which the
 * save moved already) is kept as it is, since moving it twice would point
 * its references somewhere else.
 */
export function rebaseDraft<
  D extends { data?: Record<string, unknown>; body?: string },
>(
  draft: D,
  col: CollectionConfig | SingletonConfig,
  config: VestryConfig,
  from: string,
  to: string,
  saved?: Record<string, unknown>,
): D {
  const data = draft.data === saved ? undefined : draft.data;
  const moved = rebaseEntry(
    col,
    config,
    { data: data ?? {}, body: draft.body ?? "" },
    from,
    to,
  );
  return {
    ...draft,
    ...(data && { data: moved.data }),
    ...(draft.body !== undefined && { body: moved.body }),
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
  openedFile,
  config,
  sha,
  isNew,
  rename,
  uploads,
  state: edited,
}: {
  kind: Kind;
  col: CollectionConfig | SingletonConfig;
  collectionKey: string;
  pattern: PathPattern;
  /** The file the entry is saved in, and the one its editor opened (see `openedFile`). */
  filePath: string;
  openedFile: string;
  config: VestryConfig;
  state: { data: Record<string, unknown>; body: string };
  sha: string | null;
  isNew: boolean;
  /** The slugs of a rename, from and to. */
  rename: { from: string; to: string } | null;
  uploads: Record<string, PendingUpload>;
}): Promise<SaveEntryInput & { data: Record<string, unknown> }> {
  const state = rebaseEntry(col, config, edited, openedFile, filePath);
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
  saved,
  siteUrl,
}: {
  kind: Kind;
  col: CollectionConfig | SingletonConfig;
  data: Record<string, unknown>;
  isNew: boolean;
  /** The slug the entry will be saved under. */
  slug: string;
  /** The entry as saved, which its live page shows; null for a new one. */
  saved: Saved | null;
  siteUrl: string | undefined;
}) {
  const collection = kind === "collection" ? (col as CollectionConfig) : null;
  const titleField = collection ? (collection.titleField ?? "title") : null;
  const titleInput =
    titleField && col.schema[titleField]?.type === "text" ? titleField : null;
  const statusField = collection?.status?.field ?? null;
  const publishedWhen = collection?.status?.publishedWhen ?? true;
  // The page as it is on the site: an unsaved edit hasn't moved it yet.
  const livePath =
    saved && !isNew ? sitePath(col, saved.slug, saved.data) : null;
  return {
    titleInput,
    titleValue: titleField ? String(data[titleField] ?? "") : col.label,
    statusField,
    publishedWhen,
    isPublished: statusField
      ? Boolean(data[statusField]) === publishedWhen
      : null,
    previewHref: livePath === null ? null : siteHref(siteUrl, livePath),
    address: collection
      ? entryAddress(siteUrl, livePath, pagePath(collection, slug, data))
      : null,
    /** The title and status have controls of their own. */
    editable: (key: string) => key !== statusField && key !== titleInput,
  };
}

/**
 * The page's address under the title: where the saved entry is on the site,
 * linked, or where a new one will be. Null without a `previewUrl`.
 */
function entryAddress(
  siteUrl: string | undefined,
  livePath: string | null,
  newPath: string | null,
): { text: string; href: string | null } | null {
  const path = livePath ?? newPath;
  if (path === null) return null;
  const href = siteHref(siteUrl, path);
  return {
    text: href.replace(/^https?:\/\//, ""),
    href: livePath === null ? null : href,
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

/** An entry's slug and data as last saved. */
export type Saved = { slug: string; data: Record<string, unknown> };

/**
 * The path of an entry's page on the site, from its collection's
 * `previewUrl`, or null without one.
 */
function sitePath(
  col: CollectionConfig | SingletonConfig,
  slug: string,
  data: Record<string, unknown>,
): string | null {
  return col.previewUrl
    ? fillTemplate(col.previewUrl, { ...data, slug })
    : null;
}

/**
 * The path an unsaved slug gives the entry's page (see `sitePath`). Until
 * the slug has a name (after its date, or in a folder), an ellipsis stands
 * in for it; a saved slug is used as it is, whatever it ends with.
 */
export function pagePath(
  col: CollectionConfig | SingletonConfig,
  slug: string,
  data: Record<string, unknown>,
): string | null {
  return sitePath(col, /(^|[/-])$/.test(slug) ? `${slug}…` : slug, data);
}

/**
 * The line under the slug box, shown only where it says what saving will
 * do: the page's new address when an edit (to the slug, a date it holds,
 * or another field the `previewUrl` names) moves it, else the file a
 * rename moves it to. A new entry names its file, unless its address
 * shows under its title.
 */
export function slugHint({
  collection,
  pattern,
  slug,
  data,
  saved,
  renaming,
  addressShown,
}: {
  collection: CollectionConfig;
  pattern: PathPattern;
  slug: string;
  data: Record<string, unknown>;
  /** The entry as saved; null for a new one. */
  saved: Saved | null;
  renaming: boolean;
  /** The page's address shows under the title (a text field's). */
  addressShown: boolean;
}): SlugHint | null {
  if (pattern.single) return null;
  if (!saved)
    return collection.previewUrl && addressShown
      ? null
      : { lead: null, path: entryPath(pattern, slug || "…") };
  const moved =
    sitePath(collection, slug, data) !==
    sitePath(collection, saved.slug, saved.data);
  const path = pagePath(collection, slug, data);
  if (moved && path !== null) return { lead: "Moves to", path };
  if (!renaming) return null;
  return { lead: "Renames the file to", path: entryPath(pattern, slug) };
}

/** The line under the slug box: what saving moves, and to where. */
export type SlugHint = { lead: string | null; path: string };

/**
 * `schema` with every field read-only, nested ones included, for a
 * read-only collection.
 */
export function readOnlySchema(schema: Schema): Schema {
  return Object.fromEntries(
    Object.entries(schema).map(([key, field]) => [key, readOnlyField(field)]),
  );
}

function readOnlyField(field: Field): Field {
  switch (field.type) {
    case "object":
    case "tree":
      return { ...field, readOnly: true, fields: readOnlySchema(field.fields) };
    case "array":
      return { ...field, readOnly: true, of: readOnlyField(field.of) };
    default:
      return { ...field, readOnly: true };
  }
}

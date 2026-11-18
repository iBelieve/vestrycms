import type {
  AssetContainerConfig,
  CollectionConfig,
  EntryFormat,
  Schema,
  SingletonConfig,
  VestryConfig,
} from "../config/types.js";
import {
  applyAutoFields,
  compareSortValues,
  filenameDateKey,
  referencesCollection,
  rewriteReferences,
  slugWithDate,
  summaryData,
  toEditorValues,
  toStoredValues,
  withFilenameDate,
} from "./values.js";
import {
  parseEntry,
  parseEntryList,
  serializeEntry,
  serializeEntryList,
  splitFrontmatter,
} from "./entries.js";
import type { BuildIndex } from "./index-types.js";
import {
  basename,
  collectionFormat,
  isEditable,
  isReadOnly,
  isReservedSlug,
  reservedSlugProblem,
  dirname,
  entryPath,
  extname,
  fillTemplate,
  isSafeRepoPath,
  isSafeSlug,
  joinPath,
  normalizePath,
  parsePathPattern,
  type PathPattern,
  safeFileName,
  slugFromPath,
  slugify,
} from "./paths.js";
import {
  base64Decode,
  gitBlobSha,
  SourceError,
  toText,
  type ContentSource,
  type FileChange,
  type TreeEntry,
} from "./source.js";

export interface EntrySummary {
  slug: string;
  path: string;
  sha: string;
  title: string;
  /** The fields a list can show, sort or search by (see `summaryData`). */
  data: Record<string, unknown>;
  status: "published" | "draft" | null;
  excerpt?: string;
}

/** An entry or singleton with a reference field pointing at another entry. */
export interface EntryReference {
  kind: "collection" | "singleton";
  /** Collection or singleton key. */
  key: string;
  /** Collection or singleton label. */
  label: string;
  /** Entry slug (the singleton key for singletons). */
  slug: string;
  title: string;
  path: string;
}

export interface EntryDetail extends EntrySummary {
  body: string;
  /** Head commit when the entry was read, for conflict detection. */
  head: string;
}

export interface Upload {
  /** Repository path to write the file to. */
  path: string;
  /** Base64 file contents. */
  base64: string;
}

export interface SaveEntryInput {
  data: Record<string, unknown>;
  body?: string;
  /**
   * Full file text composed (and formatted) by the client. When present it is
   * written verbatim; `data`/`body` are still used for slugs and messages.
   */
  raw?: string;
  /**
   * Slug for a new entry (otherwise derived from the slug template / title).
   * For an existing entry, a different slug renames its file.
   */
  slug?: string;
  /** Blob SHA the client last saw for this entry (omit for new entries). */
  sha?: string | null;
  uploads?: Upload[];
  message?: string;
}

/** What `saveEntry` returns. */
export interface SavedEntry {
  slug: string;
  sha: string;
  commit: string;
  path: string;
}

/** An entry being saved, as `saveEntry` hands it to its steps. */
interface EntrySave {
  key: string;
  col: CollectionConfig;
  pattern: PathPattern;
  format: EntryFormat;
  /** The entry's slug, or null for a new entry. */
  slug: string | null;
  input: SaveEntryInput;
  /** The input's data, with automatic fields filled in. */
  data: Record<string, unknown>;
}

export interface AssetItem {
  name: string;
  path: string;
  sha: string;
  size?: number;
  kind: "image" | "file";
  ext: string;
}

const IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "svg",
]);

export class ContentService {
  constructor(
    public config: VestryConfig,
    public source: ContentSource,
    private index: BuildIndex,
  ) {}

  collection(key: string): CollectionConfig {
    const c = this.config.collections?.[key];
    if (!c)
      throw new SourceError(`Unknown collection "${key}"`, 404, "not_found");
    return c;
  }

  singleton(key: string): SingletonConfig {
    const s = this.config.singletons?.[key];
    if (!s)
      throw new SourceError(`Unknown singleton "${key}"`, 404, "not_found");
    return s;
  }

  assetContainer(key: string): AssetContainerConfig {
    const a = this.config.assets?.[key];
    if (!a)
      throw new SourceError(
        `Unknown asset container "${key}"`,
        404,
        "not_found",
      );
    return a;
  }

  // ---------------------------------------------------------------- entries

  async listEntries(key: string): Promise<EntrySummary[]> {
    const col = this.collection(key);
    const pattern = parsePathPattern(col.path);
    const format = collectionFormat(col);

    if (pattern.single) {
      const file = await this.source.read(pattern.prefix);
      if (!file) return [];
      const items = parseEntryList(format, toText(file.bytes));
      const idField = col.idField ?? "id";
      return items.map((data) => {
        const slug = String(data[idField] ?? "");
        return {
          slug,
          path: pattern.prefix,
          sha: file.sha,
          title: this.titleOf(col, data, slug),
          data: toEditorValues(
            col.schema,
            summaryData(col, data),
            pattern.prefix,
          ),
          status: statusOf(col, data),
        };
      });
    }

    const files = (await this.source.list(pattern.directory)).filter(
      (f) => slugFromPath(pattern, f.path) !== null,
    );
    const summaries = await Promise.all(
      files.map(async (f) => {
        const { data, excerpt } = await this.frontmatterFor(f, format);
        const slug = slugFromPath(pattern, f.path)!;
        return {
          slug,
          path: f.path,
          sha: f.sha,
          title: this.titleOf(col, data, slug),
          data: withFilenameDate(
            col.schema,
            toEditorValues(col.schema, summaryData(col, data), f.path),
            slug,
          ),
          status: statusOf(col, data),
          excerpt,
        } satisfies EntrySummary;
      }),
    );
    return sortEntries(col, summaries);
  }

  /**
   * Frontmatter for a file: served from the build-time index when the blob
   * SHA still matches, otherwise read from the source.
   */
  private async frontmatterFor(
    file: TreeEntry,
    format: CollectionConfig["format"] & string,
  ): Promise<{ data: Record<string, unknown>; excerpt?: string }> {
    const indexed = this.index.files[file.path];
    if (indexed && indexed.sha === file.sha) {
      return { data: indexed.data, excerpt: indexed.excerpt };
    }
    const data = await this.source.read(file.path);
    if (!data) return { data: {} };
    const text = toText(data.bytes);
    const parsed = parseEntry(format, text);
    return { data: parsed.data, excerpt: makeExcerpt(parsed.body) };
  }

  async getEntry(key: string, slug: string): Promise<EntryDetail | null> {
    const col = this.collection(key);
    const pattern = parsePathPattern(col.path);
    const format = collectionFormat(col);
    const head = await this.source.head();

    if (pattern.single) {
      const file = await this.source.read(pattern.prefix);
      if (!file) return null;
      const items = parseEntryList(format, toText(file.bytes));
      const idField = col.idField ?? "id";
      const data = items.find((i) => String(i[idField]) === slug);
      if (!data) return null;
      return {
        slug,
        path: pattern.prefix,
        sha: file.sha,
        title: this.titleOf(col, data, slug),
        data: toEditorValues(col.schema, data, pattern.prefix),
        status: statusOf(col, data),
        body: "",
        head,
      };
    }

    if (!isSafeSlug(slug))
      throw new SourceError("Invalid slug", 400, "bad_slug");
    const path = entryPath(pattern, slug);
    const file = await this.source.read(path);
    if (!file) return null;
    const parsed = parseEntry(format, toText(file.bytes));
    return {
      slug,
      path,
      sha: file.sha,
      title: this.titleOf(col, parsed.data, slug),
      data: withFilenameDate(
        col.schema,
        toEditorValues(col.schema, parsed.data, path),
        slug,
      ),
      status: statusOf(col, parsed.data),
      body: parsed.body,
      head,
    };
  }

  async saveEntry(
    key: string,
    slug: string | null,
    input: SaveEntryInput,
  ): Promise<SavedEntry> {
    const col = this.collection(key);
    refuseReadOnly(col);
    const save: EntrySave = {
      key,
      col,
      pattern: parsePathPattern(col.path),
      format: collectionFormat(col),
      slug,
      input,
      data: applyAutoFields(col.schema, { ...input.data }, new Date(), {
        keepWallClock: true,
      }),
    };
    if (slug === null) refuseCreate(col);
    return save.pattern.single
      ? this.saveListEntry(save)
      : this.saveFileEntry(save);
  }

  /** Save an entry of a collection kept as a list in one file. */
  private async saveListEntry(save: EntrySave): Promise<SavedEntry> {
    const { key, col, pattern, format, slug, input, data } = save;
    const isNew = slug === null;
    const items = await this.readList(save);
    const id = this.listEntryId(save);
    const index = this.putInList(save, items, id);
    // A changed id renames the entry: every reference to the old one, in
    // this list and in other files, follows it in the same commit.
    const renamedFrom = !isNew && index !== -1 && id !== slug ? slug : null;
    // An id the list doesn't hold yet adds an entry, even under a slug.
    const adding = index === -1;
    if (adding) refuseCreate(col);
    if (renamedFrom) refuseRename(col, renamedFrom);
    if (adding || renamedFrom) refuseReserved(col, id);
    const text = serializeEntryList(
      format,
      renamedFrom
        ? renameInList(col.schema, items, key, renamedFrom, id)
        : items,
    );
    const changes: FileChange[] = [
      { path: pattern.prefix, content: text },
      ...(renamedFrom
        ? await this.referenceChanges(key, renamedFrom, id, [pattern.prefix])
        : []),
      ...uploadChanges(input.uploads),
    ];
    const action = isNew ? "Create" : renamedFrom ? "Rename" : "Update";
    const commit = await this.source.commit(changes, {
      message: this.commitMessage(
        col,
        action,
        id,
        this.titleOf(col, data, id),
        key,
        input.message,
      ),
    });
    return {
      slug: id,
      sha: await gitBlobSha(text),
      commit: commit.sha,
      path: pattern.prefix,
    };
  }

  /** A list's entries, refusing a save over a newer version of its file. */
  private async readList({
    pattern,
    format,
    input,
  }: EntrySave): Promise<Record<string, unknown>[]> {
    const file = await this.source.read(pattern.prefix);
    if (!file) return [];
    if (input.sha && input.sha !== file.sha) {
      throw new SourceError(
        "This file changed since you opened it.",
        409,
        "conflict",
      );
    }
    return parseEntryList(format, toText(file.bytes));
  }

  /** The id a list entry is saved under, which its data then holds. */
  private listEntryId({ col, slug, data }: EntrySave): string {
    const idField = col.idField ?? "id";
    const given = data[idField];
    const id = String(given ?? slug ?? this.newSlug(col, data));
    if (!id)
      throw new SourceError(`Entries need an "${idField}"`, 400, "validation");
    // An id given keeps its type: a number stays a number in the file.
    if (given === undefined || given === null) data[idField] = id;
    return id;
  }

  /**
   * Puts the entry in its place in the list, or at its end if new, and
   * returns the index it had (-1 if none).
   */
  private putInList(
    { col, pattern, slug, data }: EntrySave,
    items: Record<string, unknown>[],
    id: string,
  ): number {
    const idField = col.idField ?? "id";
    const index = items.findIndex((i) => String(i[idField]) === (slug ?? id));
    // A new entry, or one whose id changes, must not take another's id.
    const clash = items.findIndex((i) => String(i[idField]) === id);
    if (clash !== -1 && (slug === null || clash !== index)) {
      throw new SourceError(
        `An entry with id "${id}" already exists`,
        409,
        "exists",
      );
    }
    const stored = toStoredValues(col.schema, data, pattern.prefix);
    if (index === -1) items.push(stored);
    else items[index] = stored;
    return index;
  }

  /** Save an entry kept in a file of its own, renaming it if its slug changes. */
  private async saveFileEntry(save: EntrySave): Promise<SavedEntry> {
    const { key, col, pattern, format, slug, input } = save;
    const isNew = slug === null;
    const finalSlug = this.slugToSave(save);
    const path = entryPath(pattern, finalSlug);
    const renamedFrom =
      !isNew && finalSlug !== slug ? entryPath(pattern, slug) : null;
    if (renamedFrom) refuseRename(col, slug!);
    if (isNew || renamedFrom) refuseReserved(col, finalSlug);
    const exists = await this.checkSaveTarget(save, path, renamedFrom);
    // Saved under a slug that has no file yet, the entry is created there.
    if (!isNew && !exists) {
      refuseCreate(col);
      refuseReserved(col, finalSlug);
    }
    // An entry that refers to itself follows its own rename. (A file composed
    // by the client, `raw`, has had the same done to it there.)
    const data = renamedFrom
      ? (rewriteReferences(col.schema, save.data, key, slug!, finalSlug) ??
        save.data)
      : save.data;
    const stored = toStoredValues(col.schema, data, path);
    const text =
      input.raw ??
      serializeEntry(format, { data: stored, body: input.body ?? "" });
    const changes: FileChange[] = [
      { path, content: text },
      // A rename is the new file and the removal of the old one, together
      // with every entry that referred to the old slug.
      ...(renamedFrom
        ? [
            { path: renamedFrom, delete: true as const },
            ...(await this.referenceChanges(key, slug!, finalSlug, [
              path,
              renamedFrom,
            ])),
          ]
        : []),
      ...uploadChanges(input.uploads),
    ];
    const action = isNew ? "Create" : renamedFrom ? "Rename" : "Update";
    const commit = await this.source.commit(changes, {
      message: this.commitMessage(
        col,
        action,
        finalSlug,
        this.titleOf(col, data, finalSlug),
        key,
        input.message,
      ),
    });
    return {
      slug: finalSlug,
      sha: await gitBlobSha(text),
      commit: commit.sha,
      path,
    };
  }

  /**
   * The slug to save under. A new entry takes the one given or derives it;
   * an existing entry keeps its own unless a different one is given (a
   * rename). A date kept in the file name is then made its prefix, so
   * changing that date renames the file too.
   */
  private slugToSave({ col, pattern, slug, input, data }: EntrySave): string {
    // The current slug names the file a rename deletes.
    if (slug !== null && !isSafeSlug(slug))
      throw new SourceError(`Invalid slug "${slug}"`, 400, "bad_slug");
    const requested = input.slug?.trim();
    let finalSlug =
      slug === null ? requested || this.newSlug(col, data) : requested || slug;
    const filenameDate = filenameDateKey(col.schema);
    if (filenameDate) finalSlug = slugWithDate(finalSlug, data[filenameDate]);
    if (!isSafeSlug(finalSlug))
      throw new SourceError(`Invalid slug "${finalSlug}"`, 400, "bad_slug");
    // A `*` path lists only the files directly in its directory, so an entry
    // written into a subfolder would never show up again.
    if (!pattern.deep && finalSlug.includes("/"))
      throw new SourceError(
        `Slug "${finalSlug}" contains "/", which needs a "**" wildcard in the collection's path`,
        400,
        "bad_slug",
      );
    return finalSlug;
  }

  /**
   * Refuses to overwrite another entry, and to save over a version newer
   * than the one the editor opened. Returns whether the entry being saved
   * already has a file.
   */
  private async checkSaveTarget(
    { slug, input }: EntrySave,
    path: string,
    renamedFrom: string | null,
  ): Promise<boolean> {
    const isNew = slug === null;
    const target = await this.source.read(path);
    if ((isNew || renamedFrom) && target) {
      throw new SourceError(
        `An entry at "${path}" already exists`,
        409,
        "exists",
      );
    }
    const existing = renamedFrom ? await this.source.read(renamedFrom) : target;
    // The file is gone: someone renamed or deleted the entry. Saving it as
    // opened would bring it back.
    const gone =
      !isNew && !existing && (renamedFrom !== null || Boolean(input.sha));
    const changed =
      !isNew && existing && input.sha && input.sha !== existing.sha;
    if (gone || changed) {
      throw new SourceError(
        "This entry changed since you opened it.",
        409,
        "conflict",
      );
    }
    return Boolean(existing);
  }

  /**
   * Entries and singletons whose reference fields point at entry `slug` of
   * collection `key`. References inside MDX component props are not found.
   */
  async referencesTo(key: string, slug: string): Promise<EntryReference[]> {
    this.collection(key);
    const found: EntryReference[] = [];
    for (const [colKey, col] of Object.entries(this.config.collections ?? {})) {
      if (referencesCollection(col.schema, key))
        found.push(...(await this.entriesReferring(colKey, col, key, slug)));
    }
    for (const [sKey, s] of Object.entries(this.config.singletons ?? {})) {
      if (!referencesCollection(s.schema, key)) continue;
      const entry = await this.getSingleton(sKey);
      if (!rewriteReferences(s.schema, entry.data, key, slug, slug)) continue;
      found.push({
        kind: "singleton",
        key: sKey,
        label: s.label,
        slug: sKey,
        title: s.label,
        path: entry.path,
      });
    }
    return found;
  }

  /** The entries of collection `colKey` that refer to entry `slug` of `key`. */
  private async entriesReferring(
    colKey: string,
    col: CollectionConfig,
    key: string,
    slug: string,
  ): Promise<EntryReference[]> {
    const found: EntryReference[] = [];
    for (const entry of await this.listEntries(colKey)) {
      if (colKey === key && entry.slug === slug) continue;
      if (!rewriteReferences(col.schema, entry.data, key, slug, slug)) continue;
      found.push({
        kind: "collection",
        key: colKey,
        label: col.label,
        slug: entry.slug,
        title: entry.title,
        path: entry.path,
      });
    }
    return found;
  }

  /**
   * File changes that repoint every reference to a renamed entry. Each file
   * is rewritten from its parsed contents, so only the references change in
   * the data, though the frontmatter is serialized afresh.
   */
  private async referenceChanges(
    key: string,
    from: string,
    to: string,
    skipPaths: string[],
  ): Promise<FileChange[]> {
    const references = await this.referencesTo(key, from);
    const paths = [...new Set(references.map((r) => r.path))].filter(
      (path) => !skipPaths.includes(path),
    );
    const changes: FileChange[] = [];
    for (const path of paths) {
      const reference = references.find((r) => r.path === path)!;
      const owner =
        reference.kind === "collection"
          ? this.collection(reference.key)
          : this.singleton(reference.key);
      const format = collectionFormat(owner);
      const file = await this.source.read(path);
      if (!file) continue;
      const text = toText(file.bytes);
      const single =
        reference.kind === "collection" && parsePathPattern(owner.path).single;
      if (single) {
        const items = renameInList(
          owner.schema,
          parseEntryList(format, text),
          key,
          from,
          to,
        );
        changes.push({ path, content: serializeEntryList(format, items) });
      } else {
        const parsed = parseEntry(format, text);
        const data = rewriteReferences(
          owner.schema,
          parsed.data,
          key,
          from,
          to,
        );
        if (!data) continue;
        changes.push({
          path,
          content: serializeEntry(format, { data, body: parsed.body }),
        });
      }
    }
    return changes;
  }

  async deleteEntry(key: string, slug: string): Promise<{ commit: string }> {
    const col = this.collection(key);
    if (!isEditable(col))
      throw new SourceError(
        "Deleting is disabled for this collection",
        403,
        "forbidden",
      );
    if (isReservedSlug(col, slug))
      throw new SourceError(
        `"${slug}" is a reserved slug, so it can't be deleted`,
        403,
        "forbidden",
      );
    const pattern = parsePathPattern(col.path);
    const format = collectionFormat(col);
    if (pattern.single) {
      const idField = col.idField ?? "id";
      const file = await this.source.read(pattern.prefix);
      const items = file ? parseEntryList(format, toText(file.bytes)) : [];
      const next = items.filter((i) => String(i[idField]) !== slug);
      if (next.length === items.length)
        throw new SourceError("Entry not found", 404, "not_found");
      const commit = await this.source.commit(
        [{ path: pattern.prefix, content: serializeEntryList(format, next) }],
        { message: this.commitMessage(col, "Delete", slug, slug, key) },
      );
      return { commit: commit.sha };
    }
    if (!isSafeSlug(slug))
      throw new SourceError("Invalid slug", 400, "bad_slug");
    const path = entryPath(pattern, slug);
    const commit = await this.source.commit([{ path, delete: true }], {
      message: this.commitMessage(col, "Delete", slug, slug, key),
    });
    return { commit: commit.sha };
  }

  // -------------------------------------------------------------- singletons

  async getSingleton(key: string): Promise<EntryDetail> {
    const s = this.singleton(key);
    const format = collectionFormat(s);
    const path = normalizePath(s.path);
    const head = await this.source.head();
    const file = await this.source.read(path);
    const parsed = file
      ? parseEntry(format, toText(file.bytes))
      : { data: {}, body: "" };
    return {
      slug: key,
      path,
      sha: file?.sha ?? "",
      title: s.label,
      data: toEditorValues(s.schema, parsed.data, path),
      status: null,
      body: parsed.body,
      head,
    };
  }

  async saveSingleton(
    key: string,
    input: SaveEntryInput,
  ): Promise<{ sha: string; commit: string }> {
    const s = this.singleton(key);
    const format = collectionFormat(s);
    const path = normalizePath(s.path);
    const existing = await this.source.read(path);
    if (existing && input.sha && input.sha !== existing.sha) {
      throw new SourceError(
        "This file changed since you opened it.",
        409,
        "conflict",
      );
    }
    const data = applyAutoFields(s.schema, { ...input.data }, new Date(), {
      keepWallClock: true,
    });
    const stored = toStoredValues(s.schema, data, path);
    const text =
      input.raw ??
      serializeEntry(format, { data: stored, body: input.body ?? "" });
    const commit = await this.source.commit(
      [{ path, content: text }, ...uploadChanges(input.uploads)],
      {
        message:
          input.message ??
          fillTemplate(
            s.commitMessage ?? this.config.commitMessage ?? "Update {title}",
            {
              action: "Update",
              title: s.label,
              slug: key,
              collection: key,
            },
          ),
      },
    );
    return { sha: await gitBlobSha(text), commit: commit.sha };
  }

  // ------------------------------------------------------------------ assets

  async listAssets(
    containerKey: string,
    subdir = "",
  ): Promise<{ items: AssetItem[]; folders: string[] }> {
    const container = this.assetContainer(containerKey);
    const dir = joinPath(container.directory, subdir);
    if (
      !isSafeRepoPath(dir) ||
      !dir.startsWith(normalizePath(container.directory))
    ) {
      throw new SourceError("Invalid directory", 400, "bad_path");
    }
    const files = await this.source.list(dir);
    const items: AssetItem[] = [];
    const folders = new Set<string>();
    const prefix = `${dir}/`;
    for (const f of files) {
      const rest = f.path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash !== -1) {
        folders.add(rest.slice(0, slash));
        continue;
      }
      if (rest.startsWith(".")) continue;
      const ext = extname(rest);
      items.push({
        name: rest,
        path: f.path,
        sha: f.sha,
        size: f.size,
        ext,
        kind: IMAGE_EXTS.has(ext) ? "image" : "file",
      });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return { items, folders: [...folders].sort() };
  }

  async uploadAssets(
    containerKey: string,
    subdir: string,
    files: { name: string; base64: string }[],
  ): Promise<{ commit: string; paths: string[] }> {
    const container = this.assetContainer(containerKey);
    const dir = joinPath(container.directory, subdir);
    const changes: FileChange[] = [];
    const paths: string[] = [];
    for (const f of files) {
      const name = safeFileName(f.name);
      const ext = extname(name);
      const accept = container.accept;
      if (accept && !accept.includes(ext)) {
        throw new SourceError(
          `"${name}" is not an accepted file type`,
          400,
          "validation",
        );
      }
      const path = joinPath(dir, name);
      if (!isSafeRepoPath(path))
        throw new SourceError("Invalid file name", 400, "bad_path");
      changes.push({ path, content: base64Decode(f.base64) });
      paths.push(path);
    }
    const commit = await this.source.commit(changes, {
      message:
        files.length === 1
          ? `Upload ${basename(paths[0])} to ${dir}`
          : `Upload ${files.length} files to ${dir}`,
    });
    return { commit: commit.sha, paths };
  }

  async deleteAsset(
    containerKey: string,
    path: string,
  ): Promise<{ commit: string }> {
    const container = this.assetContainer(containerKey);
    const n = normalizePath(path);
    if (
      !n.startsWith(`${normalizePath(container.directory)}/`) ||
      !isSafeRepoPath(n)
    ) {
      throw new SourceError(
        "Path is outside the asset container",
        400,
        "bad_path",
      );
    }
    const commit = await this.source.commit([{ path: n, delete: true }], {
      message: `Delete ${basename(n)}`,
    });
    return { commit: commit.sha };
  }

  /** Raw file read restricted to configured asset containers and entry directories. */
  async readFile(
    path: string,
  ): Promise<{ bytes: Uint8Array; sha: string } | null> {
    const n = normalizePath(path);
    if (!isSafeRepoPath(n))
      throw new SourceError("Invalid path", 400, "bad_path");
    const allowed = this.allowedDirectories().some((d) =>
      n.startsWith(`${d}/`),
    );
    if (!allowed)
      throw new SourceError(
        "Path is not readable through Vestry",
        403,
        "forbidden",
      );
    return this.source.read(n);
  }

  allowedDirectories(): string[] {
    const dirs = new Set<string>();
    if (this.config.logo && !/^https?:\/\//.test(this.config.logo)) {
      dirs.add(dirname(normalizePath(this.config.logo)));
    }
    for (const a of Object.values(this.config.assets ?? {}))
      dirs.add(normalizePath(a.directory));
    const addSchemaDirs = (schema: Schema) => {
      for (const f of Object.values(schema)) {
        if (f.type === "image" || f.type === "file")
          dirs.add(normalizePath(f.directory));
        if (f.type === "object") addSchemaDirs(f.fields);
        if (f.type === "array") addSchemaDirs({ item: f.of });
      }
    };
    for (const c of Object.values(this.config.collections ?? {}))
      addSchemaDirs(c.schema);
    for (const s of Object.values(this.config.singletons ?? {}))
      addSchemaDirs(s.schema);
    for (const c of Object.values(this.config.components ?? {}))
      addSchemaDirs(c.props ?? {});
    return [...dirs];
  }

  // ----------------------------------------------------------------- helpers

  titleOf(
    col: CollectionConfig,
    data: Record<string, unknown>,
    slug: string,
  ): string {
    const v = data[col.titleField ?? "title"];
    return typeof v === "string" && v.trim() ? v : slug;
  }

  newSlug(col: CollectionConfig, data: Record<string, unknown>): string {
    const template = col.slug?.template;
    if (template) return fillTemplate(template, data, { slug: true });
    const from = col.slug?.from ?? col.titleField ?? "title";
    const v = data[from];
    const s =
      v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "");
    const slug = slugify(s);
    if (!slug)
      throw new SourceError(
        `Cannot derive a slug from "${from}"`,
        400,
        "validation",
      );
    return slug;
  }

  commitMessage(
    col: CollectionConfig,
    action: string,
    slug: string,
    title: string,
    collection: string,
    override?: string,
  ): string {
    if (override?.trim()) return override.trim();
    const template =
      col.commitMessage ??
      this.config.commitMessage ??
      "{action} {singular}: {title}";
    return fillTemplate(template, {
      action,
      slug,
      title,
      collection,
      label: col.label,
      singular: col.singular ?? col.label,
    });
  }
}

/** Refuses any save to a read-only collection (`editing: "none"`). */
function refuseReadOnly(col: CollectionConfig): void {
  if (isReadOnly(col))
    throw new SourceError(
      `${col.label} are read-only in the control panel`,
      403,
      "forbidden",
    );
}

/** Refuses a new entry where the collection doesn't allow creating them. */
function refuseCreate(col: CollectionConfig): void {
  if (!isEditable(col))
    throw new SourceError(
      "Creating entries is disabled for this collection",
      403,
      "forbidden",
    );
}

/** Refuses to rename entry `slug` when its slug is fixed. */
function refuseRename(col: CollectionConfig, slug: string): void {
  if (!isEditable(col))
    throw new SourceError(
      "Renaming is disabled for this collection",
      403,
      "forbidden",
    );
  if (isReservedSlug(col, slug))
    throw new SourceError(
      `"${slug}" is a reserved slug, so it can't be renamed`,
      403,
      "forbidden",
    );
}

/** Refuses to put an entry at, or under, a reserved slug. */
function refuseReserved(col: CollectionConfig, slug: string): void {
  const problem = reservedSlugProblem(col, slug);
  if (problem) throw new SourceError(problem, 409, "exists");
}

/** A list's entries with every reference to entry `from` of `key` moved to `to`. */
function renameInList(
  schema: Schema,
  items: Record<string, unknown>[],
  key: string,
  from: string,
  to: string,
): Record<string, unknown>[] {
  return items.map(
    (item) => rewriteReferences(schema, item, key, from, to) ?? item,
  );
}

function statusOf(
  col: CollectionConfig,
  data: Record<string, unknown>,
): "published" | "draft" | null {
  if (!col.status) return null;
  const publishedWhen = col.status.publishedWhen ?? true;
  const field = col.schema[col.status.field];
  const fallback = field?.type === "boolean" ? (field.default ?? false) : false;
  const v = data[col.status.field];
  const bool =
    typeof v === "boolean"
      ? v
      : v === undefined || v === null
        ? fallback
        : Boolean(v);
  return bool === publishedWhen ? "published" : "draft";
}

/**
 * Entries in the collection's `sort` order. Entries without a value for the
 * sort field come last, and entries with the same value (or none) are in
 * title order, then slug order. The tree keeps this order among siblings,
 * so pages ordered by an `order` field that only some of them set list the
 * ordered ones first, then the rest alphabetically.
 */
function sortEntries(
  col: CollectionConfig,
  entries: EntrySummary[],
): EntrySummary[] {
  const dir = col.sort?.direction === "asc" ? 1 : -1;
  const field = col.sort?.field;
  const bySlug = (a: EntrySummary, b: EntrySummary) =>
    a.slug < b.slug ? -dir : a.slug > b.slug ? dir : 0;
  // Without a sort field, entries go by slug (newest first for dated ones).
  if (!field) return [...entries].sort(bySlug);
  return [...entries].sort(
    (a, b) =>
      compareSortValues(a.data[field], b.data[field], dir) ||
      a.title.localeCompare(b.title) ||
      bySlug(a, b),
  );
}

function makeExcerpt(body: string): string | undefined {
  const text = body
    .replace(/^import .*$/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>`[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 200) : undefined;
}

function uploadChanges(uploads: Upload[] | undefined): FileChange[] {
  return (uploads ?? []).map((u) => {
    if (!isSafeRepoPath(u.path))
      throw new SourceError(`Invalid upload path "${u.path}"`, 400, "bad_path");
    return { path: normalizePath(u.path), content: base64Decode(u.base64) };
  });
}

export { splitFrontmatter };

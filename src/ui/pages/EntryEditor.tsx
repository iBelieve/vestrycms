import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Save,
  Trash,
  TriangleExclamationPoint,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type {
  CollectionConfig,
  EditorSection,
  Field,
  SingletonConfig,
} from "../../config/types.js";
import { serializeEntry } from "../../core/entries.js";
import {
  collectionFormat,
  dirname,
  entryPath,
  fillTemplate as fillPathTemplate,
  isSafeSlug,
  normalizePath,
  parsePathPattern,
  relativePath,
  resolveRelative,
  slugify,
} from "../../core/paths.js";
import {
  applyAutoFields,
  assetToRepoPath,
  filenameDateKey,
  repoPathToAsset,
  slugWithDate,
  slugWithoutDate,
  toStoredValues,
} from "../../core/values.js";
import {
  ApiError,
  type EntryDetail,
  type EntryReference,
  type SaveEntryInput,
} from "../api.js";
import type { PendingUpload } from "../components/AssetPicker.js";
import type { EditorEnv } from "../components/editor/EditorContext.js";
import { RichTextEditor } from "../components/editor/RichTextEditor.js";
import { FieldSet } from "../components/fields/FieldRenderer.js";
import { TopBar } from "../components/Layout.js";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Loading,
  Spinner,
  Toggle,
  useToast,
} from "../components/ui.js";
import { useVestry } from "../context.js";
import { formatEntry } from "../lib/format.js";
import {
  defaultValues,
  deepEqual,
  fieldLabel,
  formatDate,
  validate,
  type ValidationError,
} from "../lib/utils.js";

type Kind = "collection" | "singleton";

export function CollectionEntryPage() {
  const { collection = "", "*": slug = "" } = useParams();
  return (
    <EntryEditor
      kind="collection"
      collectionKey={collection}
      slug={slug || null}
      key={`${collection}:${slug}`}
    />
  );
}

export function NewEntryPage() {
  const { collection = "" } = useParams();
  return (
    <EntryEditor
      kind="collection"
      collectionKey={collection}
      slug={null}
      isNew
      key={`${collection}:new`}
    />
  );
}

export function SingletonPage() {
  const { singleton = "" } = useParams();
  return (
    <EntryEditor
      kind="singleton"
      collectionKey={singleton}
      slug={null}
      key={`singleton:${singleton}`}
    />
  );
}

interface EditorState {
  data: Record<string, unknown>;
  body: string;
}

function EntryEditor({
  kind,
  collectionKey,
  slug,
  isNew = false,
}: {
  kind: Kind;
  collectionKey: string;
  slug: string | null;
  isNew?: boolean;
}) {
  const { config, api, client } = useVestry();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const col: CollectionConfig | SingletonConfig | undefined =
    kind === "collection"
      ? config.collections?.[collectionKey]
      : config.singletons?.[collectionKey];
  const collection = kind === "collection" ? (col as CollectionConfig) : null;

  const query = useQuery({
    queryKey:
      kind === "collection"
        ? ["entry", collectionKey, slug]
        : ["singleton", collectionKey],
    queryFn: () =>
      kind === "collection"
        ? api.getEntry(collectionKey, slug!)
        : api.getSingleton(collectionKey),
    enabled: Boolean(col) && !isNew,
    staleTime: 0,
  });

  const [state, setState] = useState<EditorState | null>(null);
  const [initial, setInitial] = useState<EditorState | null>(null);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [uploads, setUploads] = useState<Record<string, PendingUpload>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [slugInput, setSlugInput] = useState("");
  const [sha, setSha] = useState<string | null>(null);

  // Initialise state from the loaded entry (or defaults for a new one).
  useEffect(() => {
    if (!col || state) return;
    if (isNew) {
      const init = { data: defaultValues(col.schema), body: "" };
      setState(init);
      setInitial(init);
      return;
    }
    if (query.data) {
      const init = { data: query.data.data, body: query.data.body };
      setState(init);
      setInitial(init);
      setSha(query.data.sha);
    }
  }, [col, isNew, query.data, state]);

  const dirty =
    state !== null && initial !== null && !deepEqual(state, initial);

  const format = col ? collectionFormat(col) : "mdx";
  const pattern = useMemo(
    () => (col ? parsePathPattern(col.path) : null),
    [col],
  );

  // A date kept in the file name is edited with the date field, so the slug
  // box holds only what follows it.
  const dateKey =
    collection && !pattern?.single ? filenameDateKey(collection.schema) : null;

  // The slug the entry will be saved under: what was typed, else the
  // current one, else (for a new entry) one derived from its fields. A date
  // kept in the file name is always its prefix, so changing that date
  // changes the slug.
  const effectiveSlug = useMemo(() => {
    if (!collection || !state) return slug ?? "";
    if (pattern?.single) return slug ?? "";
    let base: string;
    if (slugInput) base = slugInput;
    else if (!isNew) base = slug ?? "";
    else {
      const template = collection.slug?.template;
      const from = collection.slug?.from ?? collection.titleField ?? "title";
      base = template
        ? fillPathTemplate(template, state.data, { slug: true })
        : slugify(String(state.data[from] ?? ""));
    }
    if (!dateKey) return base;
    return slugWithDate(slugWithoutDate(base), state.data[dateKey]);
  }, [collection, state, isNew, slug, slugInput, pattern, dateKey]);

  /** What the slug box shows: the slug, less a date held by the date field. */
  const slugBoxValue =
    slugInput || (dateKey ? slugWithoutDate(effectiveSlug) : effectiveSlug);
  /** The date prefix shown, fixed, in front of the slug box. */
  const slugPrefix =
    dateKey && effectiveSlug !== slugBoxValue && !slugBoxValue.includes("/")
      ? effectiveSlug.slice(0, effectiveSlug.length - slugBoxValue.length)
      : "";
  const slugError =
    kind === "collection" &&
    !pattern?.single &&
    effectiveSlug &&
    !isSafeSlug(effectiveSlug)
      ? "Use letters, numbers, hyphens, dots and underscores."
      : null;

  /** Saving will move an existing entry to a different file. */
  const renaming =
    kind === "collection" &&
    !isNew &&
    !!effectiveSlug &&
    effectiveSlug !== slug;

  // Ask before leaving the page with anything unsaved, a rename included.
  const unsaved = dirty || renaming;
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  // Entries that refer to this one, shown for confirmation before a rename.
  const [renameReferences, setRenameReferences] = useState<
    EntryReference[] | null
  >(null);

  const filePath = useMemo(() => {
    if (!pattern) return "";
    if (kind === "singleton") return normalizePath(col!.path);
    if (pattern.single) return pattern.prefix;
    return entryPath(pattern, effectiveSlug || "new-entry");
  }, [pattern, kind, col, effectiveSlug]);

  // Body editor environment: resolve image references relative to this file.
  const bodyConfig = col?.body === false ? null : (col?.body ?? {});
  const env = useMemo<EditorEnv>(() => {
    const images = bodyConfig?.images;
    const fileDir = dirname(filePath);
    const toRepoPath = (src: string): string | null => {
      if (/^https?:\/\//.test(src)) return null;
      if (images) return assetToRepoPath(images, src, filePath);
      if (src.startsWith("/")) return `public${src}`;
      if (src.startsWith(".")) return resolveRelative(fileDir, src);
      return null;
    };
    const components = Object.fromEntries(
      (bodyConfig?.components ?? [])
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
        return pending ? pending.previewUrl : api.fileUrl(repo);
      },
    };
  }, [
    bodyConfig,
    filePath,
    config.components,
    config.textStyles,
    uploads,
    api,
  ]);

  const save = useMutation({
    mutationFn: async () => {
      if (!col || !state) throw new Error("Nothing to save");
      const errs = validate(col.schema, state.data);
      setErrors(errs);
      if (errs.length) throw new Error(errs[0].message);
      const data = applyAutoFields(col.schema, state.data);
      const input: SaveEntryInput = {
        data,
        body: state.body,
        sha: isNew ? undefined : sha,
        uploads: Object.values(uploads).map((u) => ({
          path: u.path,
          base64: u.base64,
        })),
      };
      // Compose the whole file here (and format it with the project's
      // Prettier) whenever the file holds just this entry. Single-file
      // collections are merged on the server instead.
      if (kind === "singleton" || (pattern && !pattern.single)) {
        const stored = toStoredValues(col.schema, data, filePath);
        let raw = serializeEntry(format, { data: stored, body: state.body });
        try {
          raw = await formatEntry(raw, filePath, format);
        } catch (e) {
          console.warn("[vestry] formatting failed, saving unformatted", e);
        }
        input.raw = raw;
      }
      if (kind === "singleton")
        return {
          ...(await api.saveSingleton(collectionKey, input)),
          slug: collectionKey,
          data,
        };
      if (isNew) {
        input.slug = effectiveSlug;
        return { ...(await api.createEntry(collectionKey, input)), data };
      }
      if (renaming) input.slug = effectiveSlug;
      return { ...(await api.updateEntry(collectionKey, slug!, input)), data };
    },
    onSuccess: (res) => {
      toast(
        "success",
        client.mode === "local" ? "Saved to disk" : "Saved and committed",
      );
      setUploads({});
      setSha(res.sha);
      setInitial(state ? { data: res.data, body: state.body } : null);
      setState((s) => (s ? { ...s, data: res.data } : s));
      qc.invalidateQueries({ queryKey: ["entries", collectionKey] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      if (kind === "collection")
        qc.setQueryData(["entry", collectionKey, res.slug], undefined);
      // A new or renamed entry now lives at a different address.
      if (isNew || (kind === "collection" && res.slug !== slug)) {
        if (!isNew)
          qc.removeQueries({ queryKey: ["entry", collectionKey, slug] });
        navigate(`/collections/${collectionKey}/${res.slug}`, {
          replace: true,
        });
      }
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        toast(
          "error",
          `${e.message} Reload the page to pick up the latest version.`,
        );
      } else {
        toast("error", (e as Error).message);
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteEntry(collectionKey, slug!),
    onSuccess: () => {
      toast("success", "Entry deleted");
      qc.invalidateQueries({ queryKey: ["entries", collectionKey] });
      navigate(`/collections/${collectionKey}`);
    },
    onError: (e) => toast("error", (e as Error).message),
  });

  // Saving goes through here: a rename that other entries refer to is
  // confirmed first, since it changes those entries too.
  const requestSave = async () => {
    if (save.isPending || slugError) return;
    if (renaming) {
      try {
        const { references } = await api.references(collectionKey, slug!);
        if (references.length) return setRenameReferences(references);
      } catch (e) {
        return toast("error", (e as Error).message);
      }
    }
    save.mutate();
  };
  const saveRef = useRef(requestSave);
  saveRef.current = requestSave;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setData = useCallback(
    (data: Record<string, unknown>) =>
      setState((s) => (s ? { ...s, data } : s)),
    [],
  );
  const setBody = useCallback(
    (body: string) => setState((s) => (s ? { ...s, body } : s)),
    [],
  );
  const addUpload = useCallback(
    (u: PendingUpload) => setUploads((m) => ({ ...m, [u.path]: u })),
    [],
  );

  if (!col)
    return (
      <Alert kind="error">
        Unknown {kind} “{collectionKey}”.
      </Alert>
    );
  if (!isNew && query.isLoading) return <Loading />;
  if (!isNew && query.error) {
    return (
      <div className="v-page">
        <Alert kind="error">{(query.error as Error).message}</Alert>
      </div>
    );
  }
  if (!state) return <Loading />;

  const titleField =
    kind === "collection" ? (collection!.titleField ?? "title") : null;
  const titleIsText = titleField
    ? col.schema[titleField]?.type === "text"
    : false;
  const statusField = collection?.status?.field ?? null;
  const publishedWhen = collection?.status?.publishedWhen ?? true;
  const isPublished = statusField
    ? Boolean(state.data[statusField]) === publishedWhen
    : null;
  const titleValue = titleField
    ? String(state.data[titleField] ?? "")
    : col.label;
  const previewHref =
    col.previewUrl && !isNew
      ? `${config.siteUrl ?? ""}${fillPathTemplate(col.previewUrl, { ...state.data, slug: effectiveSlug })}`
      : null;
  const entry = query.data as EntryDetail | undefined;

  const sections = col.sections ?? [];
  const sectioned = new Set(
    sections.flatMap((s) => (typeof s === "string" ? [] : s.fields)),
  );
  const isEditable = (key: string) =>
    key !== statusField && !(titleIsText && key === titleField);
  const isMain = (key: string, f: Field) =>
    !f.sidebar && !sectioned.has(key) && isEditable(key);
  const isSidebar = (key: string, f: Field) =>
    Boolean(f.sidebar) && !sectioned.has(key) && isEditable(key);
  const hasVisible = (filter: (key: string, f: Field) => boolean) =>
    Object.entries(col.schema).some(([k, f]) => filter(k, f) && !f.hidden);
  const bodyPlaced = sections.includes("body");
  const sectionCard = (section: Exclude<EditorSection, "body">, i: number) => {
    const inSection = (key: string) =>
      section.fields.includes(key) && isEditable(key);
    if (!hasVisible(inSection)) return null;
    // A lone field named like its section doesn't need a second heading.
    const lone = section.fields.length === 1 ? section.fields[0] : null;
    const hideLabels =
      lone &&
      col.schema[lone] &&
      fieldLabel(lone, col.schema[lone]) === section.label
        ? [lone]
        : undefined;
    return (
      <div className="v-card" key={`section-${i}`}>
        <div className="v-card__header">
          <h3 className="v-card__title">{section.label}</h3>
          {section.description && (
            <span className="v-muted" style={{ fontSize: 12.5 }}>
              {section.description}
            </span>
          )}
        </div>
        <div className="v-card__body">
          <FieldSet
            schema={Object.fromEntries(
              section.fields
                .filter((k) => col.schema[k])
                .map((k) => [k, col.schema[k]]),
            )}
            values={state.data}
            onChange={setData}
            errors={errors}
            filter={inSection}
            ctx={ctx}
            hideLabels={hideLabels}
          />
        </div>
      </div>
    );
  };
  const bodyCard =
    bodyConfig && (format === "md" || format === "mdx") ? (
      <div className="v-card v-card--editor" key="body">
        <div className="v-card__header">
          <h3 className="v-card__title">{bodyConfig.label ?? "Content"}</h3>
        </div>
        <RichTextEditor
          value={state.body}
          onChange={setBody}
          components={bodyConfig.components ?? []}
          env={env}
          format={format}
          placeholder={bodyConfig.placeholder}
          onUpload={addUpload}
          flush
        />
      </div>
    ) : null;
  const ctx = {
    addUpload,
    pendingUploads: uploads,
    isNew,
    siblings: state.data,
  };

  return (
    <>
      <TopBar
        status={
          isPublished === null ? null : isPublished ? "published" : "draft"
        }
        crumbs={
          kind === "collection"
            ? [
                {
                  label: collection!.label,
                  to: `/collections/${collectionKey}`,
                },
              ]
            : undefined
        }
        title={
          isNew
            ? `New ${collection?.singular ?? "entry"}`
            : titleValue || effectiveSlug
        }
        actions={
          <>
            {unsaved && (
              <span className="v-unsaved">
                <TriangleExclamationPoint size={13} /> Unsaved changes
              </span>
            )}
            {previewHref && (
              <a
                className="v-btn"
                href={previewHref}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink /> View
              </a>
            )}
            {kind === "collection" &&
              !isNew &&
              collection!.delete !== false && (
                <Button
                  variant="danger"
                  icon
                  title="Delete"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash />
                </Button>
              )}
            <Button
              variant="primary"
              onClick={() => void requestSave()}
              disabled={
                save.isPending ||
                !!slugError ||
                (!unsaved && !isNew && Object.keys(uploads).length === 0)
              }
            >
              {save.isPending ? <Spinner /> : <Save />}{" "}
              {isNew ? "Create" : "Save"}
              <span className="v-kbd">⌘S</span>
            </Button>
          </>
        }
      />
      <div className="v-page">
        {errors.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <Alert kind="error">
              <strong>Please fix the following:</strong>
              <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                {errors.map((e) => (
                  <li key={e.path}>{e.message}</li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
        <div className="v-editor-layout">
          <div className="v-stack" style={{ gap: 20 }}>
            {titleIsText && (
              <div className="v-card">
                <div className="v-card__body" style={{ padding: "14px 18px" }}>
                  <input
                    className="v-title-input"
                    value={titleValue}
                    placeholder={`${fieldLabel(titleField!, col.schema[titleField!])}…`}
                    onChange={(e) =>
                      setData({ ...state.data, [titleField!]: e.target.value })
                    }
                    autoFocus={isNew}
                  />
                  {errors.some((e) => e.path === titleField) && (
                    <div className="v-field__error">
                      {errors.find((e) => e.path === titleField)!.message}
                    </div>
                  )}
                </div>
              </div>
            )}
            {sections.map((section, i) =>
              section === "body"
                ? bodyCard
                : section.sidebar
                  ? null
                  : sectionCard(section, i),
            )}
            {hasVisible(isMain) && (
              <div className="v-card">
                <div className="v-card__header">
                  <h3 className="v-card__title">Details</h3>
                </div>
                <div className="v-card__body">
                  <FieldSet
                    schema={col.schema}
                    values={state.data}
                    onChange={setData}
                    errors={errors}
                    filter={isMain}
                    ctx={ctx}
                  />
                </div>
              </div>
            )}
            {!bodyPlaced && bodyCard}
          </div>
          <aside className="v-editor-sidebar v-stack">
            {(statusField || kind === "collection") && (
              <div className="v-card">
                <div className="v-card__header">
                  <h3 className="v-card__title">Publish</h3>
                  {isPublished !== null && (
                    <span style={{ marginLeft: "auto" }}>
                      <Badge status={isPublished ? "published" : "draft"} />
                    </span>
                  )}
                </div>
                <div className="v-card__body v-stack">
                  {statusField && (
                    <Toggle
                      checked={isPublished ?? false}
                      label={isPublished ? "Published" : "Draft"}
                      onChange={(on) =>
                        setData({
                          ...state.data,
                          [statusField]: on ? publishedWhen : !publishedWhen,
                        })
                      }
                    />
                  )}
                  {kind === "collection" && (
                    <div>
                      <label className="v-field__label">Slug</label>
                      {!pattern?.single ? (
                        <div className="v-slug">
                          {slugPrefix && (
                            <span
                              className="v-slug__prefix v-mono"
                              title="Set by the date field"
                            >
                              {slugPrefix}
                            </span>
                          )}
                          <input
                            className="v-input v-input--mono"
                            value={slugBoxValue}
                            onChange={(e) => setSlugInput(e.target.value)}
                            placeholder="auto"
                            aria-invalid={slugError ? true : undefined}
                          />
                        </div>
                      ) : (
                        <input
                          className="v-input v-input--mono"
                          readOnly
                          value={effectiveSlug}
                        />
                      )}
                      {slugError && (
                        <div className="v-field__error">{slugError}</div>
                      )}
                      {(isNew || renaming) && pattern && !pattern.single && (
                        <div
                          className="v-field__hint v-mono"
                          style={{ fontSize: 11.5 }}
                        >
                          {renaming && "Renames the file to "}
                          {entryPath(pattern, effectiveSlug || "…")}
                        </div>
                      )}
                    </div>
                  )}
                  {entry && (
                    <dl className="v-meta">
                      <dt>File</dt>
                      <dd title={entry.path}>{entry.path}</dd>
                      {Object.entries(col.schema)
                        .filter(
                          ([, f]) => f.type === "datetime" && f.autoUpdate,
                        )
                        .map(([k]) => (
                          <span key={k} style={{ display: "contents" }}>
                            <dt>{fieldLabel(k, col.schema[k])}</dt>
                            <dd>
                              {state.data[k] ? formatDate(state.data[k]) : "—"}
                            </dd>
                          </span>
                        ))}
                    </dl>
                  )}
                </div>
              </div>
            )}
            {sections.map((section, i) =>
              section !== "body" && section.sidebar
                ? sectionCard(section, i)
                : null,
            )}
            {hasVisible(isSidebar) && (
              <div className="v-card">
                <div className="v-card__body">
                  <FieldSet
                    schema={col.schema}
                    values={state.data}
                    onChange={setData}
                    errors={errors}
                    filter={isSidebar}
                    ctx={ctx}
                  />
                </div>
              </div>
            )}
            {Object.keys(uploads).length > 0 && (
              <Alert kind="info">
                {Object.keys(uploads).length} new file
                {Object.keys(uploads).length === 1 ? "" : "s"} will be committed
                with this entry.
              </Alert>
            )}
          </aside>
        </div>
      </div>
      {renameReferences && (
        <ConfirmDialog
          title="Rename this entry?"
          message={
            <>
              {renameReferences.length === 1
                ? "1 other entry refers"
                : `${renameReferences.length} other entries refer`}{" "}
              to this one and will be updated in the same commit:
              <ul className="v-reference-list">
                {renameReferences.slice(0, 8).map((r) => (
                  <li key={`${r.kind}:${r.key}:${r.slug}`}>
                    {r.kind === "collection"
                      ? `${r.label}: ${r.title}`
                      : r.label}
                  </li>
                ))}
                {renameReferences.length > 8 && (
                  <li>and {renameReferences.length - 8} more</li>
                )}
              </ul>
            </>
          }
          confirmLabel="Rename and update"
          busy={save.isPending}
          onCancel={() => setRenameReferences(null)}
          onConfirm={() => {
            setRenameReferences(null);
            save.mutate();
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${titleValue}”?`}
          message="The file will be removed from the repository in a new commit."
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
    </>
  );
}

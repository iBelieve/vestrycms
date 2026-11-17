import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Save,
  Trash,
  TriangleExclamationPoint,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router";
import type {
  CollectionConfig,
  EditorSection,
  Field,
  SingletonConfig,
  VestryConfig,
} from "../../config/types.js";
import {
  collectionFormat,
  parsePathPattern,
  type PathPattern,
} from "../../core/paths.js";
import { filenameDateKey, rewriteReferences } from "../../core/values.js";
import { ApiError, type EntryDetail, type EntryReference } from "../api.js";
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
  ErrorState,
  Loading,
  NotFoundState,
  Spinner,
  Toggle,
  useToast,
} from "../components/ui.js";
import { useVestry } from "../context.js";
import {
  deepEqual,
  defaultValues,
  entryHref,
  fieldLabel,
  formatDate,
  validate,
  type ValidationError,
} from "../lib/utils.js";
import {
  bodyEnv,
  effectiveSlug,
  entryDisplay,
  entryFile,
  fieldPlacement,
  publishToggle,
  type Kind,
  saveErrorMessage,
  saveInput,
  sectionFields,
  sendSave,
  slugBox,
  slugHint,
  slugProblem,
} from "./entry-editing.js";

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

type Entry = CollectionConfig | SingletonConfig;

/**
 * What changed while a new or renamed entry was saving, which its editor at
 * the new address opens with: the data or body if they changed (the saved
 * version's otherwise), and the uploads the save did not send.
 */
interface Draft {
  data?: Record<string, unknown>;
  body?: string;
  /** What the slug box holds, if it changed. */
  typed?: string;
  uploads: Record<string, PendingUpload>;
}
/**
 * The draft a save hands to the editor it navigates to, by that editor's
 * address. There is one at most: the next editor opened takes it or, at
 * another address, drops it, so a draft never outlives that navigation.
 */
let handoff: { key: string; draft: Draft } | null = null;
const draftKey = (kind: Kind, collectionKey: string, slug: string | null) =>
  JSON.stringify([kind, collectionKey, slug]);

/** The draft a save left for this editor, taken once so it applies once. */
function useDraft(kind: Kind, collectionKey: string, slug: string | null) {
  const key = draftKey(kind, collectionKey, slug);
  const [draft] = useState(() =>
    handoff?.key === key ? handoff.draft : undefined,
  );
  useEffect(() => {
    handoff = null;
  }, [key]);
  return draft;
}

/** The configuration of the collection or global being edited, if any. */
function entryConfig(
  config: VestryConfig,
  kind: Kind,
  key: string,
): Entry | undefined {
  return kind === "collection"
    ? config.collections?.[key]
    : config.singletons?.[key];
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
  const { config, api } = useVestry();
  const col = entryConfig(config, kind, collectionKey);
  const draft = useDraft(kind, collectionKey, slug);

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

  if (!col)
    return (
      <NotFoundState
        title={`No ${kind === "singleton" ? "global" : "collection"} called “${collectionKey}”`}
      />
    );
  if (isNew)
    return <EntryForm {...{ kind, collectionKey, slug, isNew, col }} />;
  if (query.isLoading) return <Loading />;
  // A failed background refetch keeps the entry already open on screen.
  if (query.error && !query.data)
    return (
      <LoadError
        kind={kind}
        name={kind === "singleton" ? collectionKey : slug}
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  if (!query.data) return <Loading />;
  return (
    <EntryForm
      {...{ kind, collectionKey, slug, isNew, col, draft }}
      entry={query.data}
    />
  );
}

function LoadError({
  kind,
  name,
  error,
  onRetry,
  retrying,
}: {
  kind: Kind;
  name: string | null;
  error: Error;
  onRetry: () => void;
  retrying: boolean;
}) {
  const what = kind === "singleton" ? "global" : "entry";
  if (error instanceof ApiError && error.status === 404) {
    return kind === "singleton" ? (
      <NotFoundState title={`No global called “${name}”`} />
    ) : (
      <NotFoundState title={`No entry called “${name}”`}>
        It may have been renamed or deleted.
      </NotFoundState>
    );
  }
  return (
    <ErrorState
      title={`Couldn't open this ${what}`}
      error={error}
      onRetry={onRetry}
      retrying={retrying}
    >
      Vestry couldn't load it from the repository. This is often temporary, so
      try again in a moment.
    </ErrorState>
  );
}

/** The editor itself, for an entry that is loaded (or new). */
function EntryForm({
  kind,
  collectionKey,
  slug,
  isNew,
  col,
  entry,
  draft,
}: {
  kind: Kind;
  collectionKey: string;
  slug: string | null;
  isNew: boolean;
  col: Entry;
  entry?: EntryDetail;
  draft?: Draft;
}) {
  const { config, api } = useVestry();
  const collection = kind === "collection" ? (col as CollectionConfig) : null;
  const doc = useDocument(col, entry, draft);
  const { state, setData, uploads } = doc;
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pattern = useMemo(() => parsePathPattern(col.path), [col]);
  const slugs = useSlug({
    kind,
    collection,
    pattern,
    slug,
    isNew,
    state,
    draft,
  });
  const { finalSlug, renaming } = slugs;

  // Ask before leaving the page with anything unsaved, a rename included.
  const unsaved = doc.dirty || renaming;
  useLeaveWarning(unsaved);

  const filePath = entryFile(kind, col, pattern, finalSlug);
  const saving = useSave({
    kind,
    collectionKey,
    slug,
    isNew,
    col,
    pattern,
    filePath,
    doc,
    slugs,
    setErrors,
  });
  const remove = useRemove(collectionKey, slug);

  const display = entryDisplay({
    kind,
    col,
    data: state.data,
    isNew,
    slug: finalSlug,
    siteUrl: config.siteUrl,
  });
  const placement = fieldPlacement(col, display.editable);
  const fieldSet = (props: FieldSetProps) => (
    <FieldSet
      {...props}
      values={state.data}
      onChange={setData}
      errors={errors}
      ctx={{
        addUpload: doc.addUpload,
        pendingUploads: uploads,
        isNew,
        siblings: state.data,
      }}
    />
  );
  const sectionCard = (section: Exclude<EditorSection, "body">, i: number) => {
    const inSection = (key: string) =>
      section.fields.includes(key) && display.editable(key);
    if (!placement.hasVisible(inSection)) return null;
    const { schema, hideLabels } = sectionFields(col, section, fieldLabel);
    return (
      <Card
        key={`section-${i}`}
        title={section.label}
        note={section.description}
      >
        {fieldSet({ schema, filter: inSection, hideLabels })}
      </Card>
    );
  };
  const bodyCard = (
    <BodyCard
      key="body"
      col={col}
      filePath={filePath}
      config={config}
      fileUrl={api.fileUrl}
      doc={doc}
    />
  );
  const uploadCount = Object.keys(uploads).length;

  return (
    <>
      <TopBar
        status={
          display.isPublished === null ? null : statusOf(display.isPublished)
        }
        crumbs={
          collection
            ? [{ label: collection.label, to: `/collections/${collectionKey}` }]
            : undefined
        }
        title={
          isNew
            ? `New ${collection?.singular ?? "entry"}`
            : display.titleValue || finalSlug
        }
        actions={
          <EditorActions
            unsaved={unsaved}
            previewHref={display.previewHref}
            canDelete={
              kind === "collection" && !isNew && collection!.delete !== false
            }
            onDelete={() => setConfirmDelete(true)}
            onSave={() => void saving.requestSave()}
            saving={saving.save.isPending}
            saveDisabled={
              saving.save.isPending ||
              !!slugs.error ||
              (!unsaved && !isNew && uploadCount === 0)
            }
            isNew={isNew}
          />
        }
      />
      <div className="v-page">
        {errors.length > 0 && <ErrorList errors={errors} />}
        <div className="v-editor-layout">
          <div className="v-stack" style={{ gap: 20 }}>
            {display.titleInput && (
              <TitleCard
                value={display.titleValue}
                placeholder={`${fieldLabel(display.titleInput, col.schema[display.titleInput])}…`}
                onChange={(title) =>
                  setData((data) => ({
                    ...data,
                    [display.titleInput!]: title,
                  }))
                }
                autoFocus={isNew}
                error={
                  errors.find((e) => e.path === display.titleInput)?.message
                }
              />
            )}
            {placement.sections.map((section, i) =>
              section === "body"
                ? bodyCard
                : section.sidebar
                  ? null
                  : sectionCard(section, i),
            )}
            {placement.hasVisible(placement.isMain) && (
              <Card title="Details">
                {fieldSet({ schema: col.schema, filter: placement.isMain })}
              </Card>
            )}
            {!placement.bodyPlaced && bodyCard}
          </div>
          <aside className="v-editor-sidebar v-stack">
            {(display.statusField || collection) && (
              <PublishCard
                isPublished={display.isPublished}
                onPublish={publishToggle(display, state.data, setData)}
              >
                {collection && (
                  <SlugField
                    pattern={pattern}
                    slug={finalSlug}
                    box={slugs.box}
                    onChange={slugs.setTyped}
                    error={slugs.error}
                    hint={slugHint(pattern, finalSlug, isNew, renaming)}
                  />
                )}
                {entry && (
                  <EntryMeta path={entry.path} col={col} data={state.data} />
                )}
              </PublishCard>
            )}
            {placement.sections.map((section, i) =>
              section !== "body" && section.sidebar
                ? sectionCard(section, i)
                : null,
            )}
            {placement.hasVisible(placement.isSidebar) && (
              <Card>
                {fieldSet({ schema: col.schema, filter: placement.isSidebar })}
              </Card>
            )}
            {uploadCount > 0 && <UploadsNote count={uploadCount} />}
          </aside>
        </div>
      </div>
      {saving.renameReferences && (
        <RenameDialog
          references={saving.renameReferences}
          busy={saving.save.isPending}
          onCancel={() => saving.setRenameReferences(null)}
          onConfirm={() => {
            saving.setRenameReferences(null);
            saving.save.mutate();
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${display.titleValue}”?`}
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

interface FieldSetProps {
  schema: Record<string, Field>;
  filter: (key: string, f: Field) => boolean;
  hideLabels?: string[];
}

/**
 * The entry being edited, as last saved and as it stands, with its uploads.
 * A draft left by the save that created or renamed it is laid over the
 * saved version.
 */
function useDocument(
  col: Entry,
  entry: EntryDetail | undefined,
  draft: Draft | undefined,
) {
  const [initial, setInitial] = useState<EditorState>(() =>
    entry
      ? { data: entry.data, body: entry.body }
      : { data: defaultValues(col.schema), body: "" },
  );
  const [form, setForm] = useState<Form>(() => ({
    state: {
      data: draft?.data ?? initial.data,
      body: draft?.body ?? initial.body,
    },
    uploads: draft?.uploads ?? {},
  }));
  // The form as it stands, kept here too so that a save finishing reads
  // every change, including one made since the last render.
  const latest = useRef(form);
  const change = useCallback((update: (form: Form) => Form) => {
    latest.current = update(latest.current);
    setForm(latest.current);
  }, []);
  const [sha, setSha] = useState<string | null>(entry?.sha ?? null);
  /** Sets the data, or updates it as it stands. */
  const setData = useCallback(
    (
      data:
        | Record<string, unknown>
        | ((data: Record<string, unknown>) => Record<string, unknown>),
    ) =>
      change((f) => ({
        ...f,
        state: {
          ...f.state,
          data: typeof data === "function" ? data(f.state.data) : data,
        },
      })),
    [change],
  );
  const setBody = useCallback(
    (body: string) => change((f) => ({ ...f, state: { ...f.state, body } })),
    [change],
  );
  const addUpload = useCallback(
    (u: PendingUpload) =>
      change((f) => ({ ...f, uploads: { ...f.uploads, [u.path]: u } })),
    [change],
  );
  /**
   * Takes in a saved version: its data (as saving completed it), the version
   * to save on next, and what was sent. Edits and uploads made while it was
   * saving are kept, and left unsaved.
   */
  const saved = (
    data: Record<string, unknown>,
    newSha: string | null,
    sent: Sent,
  ) => {
    setSha(newSha);
    setInitial({ data, body: sent.state.body });
    change((f) => ({
      state: f.state.data === sent.state.data ? { ...f.state, data } : f.state,
      uploads: unsent(f.uploads, sent),
    }));
  };
  /**
   * What changed since `sent` was saved, for the editor a new or renamed
   * entry opens in next; null if nothing did.
   */
  const leftover = (sent: Sent, typed: string): Draft | null => {
    const now = latest.current;
    const draft: Draft = { uploads: unsent(now.uploads, sent) };
    if (now.state.data !== sent.state.data) draft.data = now.state.data;
    if (now.state.body !== sent.state.body) draft.body = now.state.body;
    if (typed !== sent.typed) draft.typed = typed;
    const changed =
      Object.keys(draft).length > 1 || Object.keys(draft.uploads).length > 0;
    return changed ? draft : null;
  };
  return {
    state: form.state,
    dirty: !deepEqual(form.state, initial),
    uploads: form.uploads,
    sha,
    setData,
    setBody,
    addUpload,
    saved,
    leftover,
  };
}
type Document = ReturnType<typeof useDocument>;

/** The entry as it stands in the editor, and the files to upload with it. */
interface Form {
  state: EditorState;
  uploads: Record<string, PendingUpload>;
}

/** What a save sent: the form as it stood, and what the slug box held. */
interface Sent extends Form {
  typed: string;
}

/** The uploads in `uploads` that `sent` did not send. */
const unsent = (uploads: Record<string, PendingUpload>, sent: Form) =>
  Object.fromEntries(
    Object.entries(uploads).filter(([path, u]) => sent.uploads[path] !== u),
  );

/** The slug an entry is saved under, and what its slug box shows. */
function useSlug({
  kind,
  collection,
  pattern,
  slug,
  isNew,
  state,
  draft,
}: {
  kind: Kind;
  collection: CollectionConfig | null;
  pattern: PathPattern;
  slug: string | null;
  isNew: boolean;
  state: EditorState;
  draft: Draft | undefined;
}) {
  const [typed, setTypedState] = useState(draft?.typed ?? "");
  // Read by a save as it finishes, so it sees a change not yet rendered.
  const latestTyped = useRef(typed);
  const setTyped = useCallback((value: string) => {
    latestTyped.current = value;
    setTypedState(value);
  }, []);
  // A date kept in the file name is edited with the date field, so the slug
  // box holds only what follows it.
  const dateKey =
    collection && !pattern.single ? filenameDateKey(collection.schema) : null;
  const finalSlug = effectiveSlug({
    collection,
    pattern,
    slug,
    typed,
    isNew,
    data: state.data,
    dateKey,
  });
  return {
    finalSlug,
    dateKey,
    setTyped,
    latestTyped: () => latestTyped.current,
    box: slugBox(finalSlug, typed, dateKey),
    error: slugProblem(kind, pattern, finalSlug),
    /** Saving will move an existing entry to a different file. */
    renaming:
      kind === "collection" && !isNew && !!finalSlug && finalSlug !== slug,
  };
}
type Slugs = ReturnType<typeof useSlug>;

/** Asks before the page is left while `unsaved`. */
function useLeaveWarning(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);
}

/**
 * Saving: the save itself, and the request (a button or the shortcut) that
 * first confirms a rename that other entries refer to, since it changes
 * those entries too.
 */
function useSave({
  kind,
  collectionKey,
  slug,
  isNew,
  col,
  pattern,
  filePath,
  doc,
  slugs,
  setErrors,
}: {
  kind: Kind;
  collectionKey: string;
  slug: string | null;
  isNew: boolean;
  col: Entry;
  pattern: PathPattern;
  filePath: string;
  doc: Document;
  slugs: Slugs;
  setErrors: (errors: ValidationError[]) => void;
}) {
  const { api, client } = useVestry();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { finalSlug, renaming } = slugs;

  const save = useMutation({
    mutationFn: async () => {
      const sent: Sent = {
        state: doc.state,
        uploads: doc.uploads,
        typed: slugs.latestTyped(),
      };
      const errs = validate(col.schema, sent.state.data);
      setErrors(errs);
      if (errs.length) throw new Error(errs[0].message);
      const input = await saveInput({
        kind,
        col,
        collectionKey,
        pattern,
        filePath,
        state: sent.state,
        sha: doc.sha,
        isNew,
        rename: renaming ? { from: slug!, to: finalSlug } : null,
        uploads: sent.uploads,
      });
      const res = await sendSave(
        api,
        { kind, collectionKey, slug, isNew, renaming, finalSlug },
        input,
      );
      return { ...res, sent };
    },
    onSuccess: (res) => {
      toast(
        "success",
        client.mode === "local" ? "Saved to disk" : "Saved and committed",
      );
      doc.saved(res.data, res.sha, res.sent);
      qc.invalidateQueries({ queryKey: ["entries", collectionKey] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      // The editor opens on what is cached, so the cache must not keep the
      // version from before this save.
      if (kind === "singleton") {
        qc.invalidateQueries({ queryKey: ["singleton", collectionKey] });
        return;
      }
      if (!isNew && res.slug === slug) {
        qc.invalidateQueries({ queryKey: ["entry", collectionKey, slug] });
        return;
      }
      // A new or renamed entry now lives at a different address, where its
      // editor opens with whatever changed while it saved.
      if (!isNew)
        qc.removeQueries({ queryKey: ["entry", collectionKey, slug] });
      qc.removeQueries({ queryKey: ["entry", collectionKey, res.slug] });
      const draft = doc.leftover(res.sent, slugs.latestTyped());
      // Its references to itself follow the rename, as the saved ones did.
      if (draft?.data && !isNew)
        draft.data =
          rewriteReferences(
            col.schema,
            draft.data,
            collectionKey,
            slug!,
            res.slug,
          ) ?? draft.data;
      handoff = draft && {
        key: draftKey(kind, collectionKey, res.slug),
        draft,
      };
      navigate(entryHref(collectionKey, res.slug), { replace: true });
    },
    onError: (e) => toast("error", saveErrorMessage(e, Boolean(slugs.dateKey))),
  });

  // Entries that refer to this one, shown for confirmation before a rename.
  const [renameReferences, setRenameReferences] = useState<
    EntryReference[] | null
  >(null);
  const checkingReferences = useRef(false);
  const requestSave = async () => {
    // The lookup below takes a moment, during which a second request (the
    // shortcut pressed twice) must not start a second save.
    if (save.isPending || slugs.error || checkingReferences.current) return;
    if (renaming) {
      checkingReferences.current = true;
      try {
        const { references } = await api.references(collectionKey, slug!);
        if (references.length) return setRenameReferences(references);
      } catch (e) {
        return toast("error", (e as Error).message);
      } finally {
        checkingReferences.current = false;
      }
    }
    save.mutate();
  };
  useSaveShortcut(requestSave);
  return { save, requestSave, renameReferences, setRenameReferences };
}

function useRemove(collectionKey: string, slug: string | null) {
  const { api } = useVestry();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteEntry(collectionKey, slug!),
    onSuccess: () => {
      toast("success", "Entry deleted");
      qc.invalidateQueries({ queryKey: ["entries", collectionKey] });
      // Not to be opened again from the cache.
      qc.removeQueries({ queryKey: ["entry", collectionKey, slug] });
      navigate(`/collections/${collectionKey}`);
    },
    onError: (e) => toast("error", (e as Error).message),
  });
}

/** The rich text editor for the entry's body, if it has one. */
function BodyCard({
  col,
  filePath,
  config,
  fileUrl,
  doc,
}: {
  col: Entry;
  filePath: string;
  config: VestryConfig;
  fileUrl: (path: string) => string;
  doc: Document;
}) {
  const format = collectionFormat(col);
  // Kept from render to render, so the editor's environment is too.
  const body = useMemo(
    () => (col.body === false ? null : (col.body ?? {})),
    [col.body],
  );
  const { uploads } = doc;
  const env = useMemo<EditorEnv>(
    () => bodyEnv({ body, filePath, config, uploads, fileUrl }),
    [body, filePath, config, uploads, fileUrl],
  );
  if (!body || (format !== "md" && format !== "mdx")) return null;
  return (
    <div className="v-card v-card--editor">
      <div className="v-card__header">
        <h3 className="v-card__title">{body.label ?? "Content"}</h3>
      </div>
      <RichTextEditor
        value={doc.state.body}
        onChange={doc.setBody}
        components={body.components ?? []}
        env={env}
        format={format}
        placeholder={body.placeholder}
        onUpload={doc.addUpload}
        flush
      />
    </div>
  );
}

function UploadsNote({ count }: { count: number }) {
  return (
    <Alert kind="info">
      {count} new file
      {count === 1 ? "" : "s"} will be committed with this entry.
    </Alert>
  );
}

const statusOf = (published: boolean) => (published ? "published" : "draft");

/** Saves on ⌘S (or Ctrl+S) with whatever `save` is at the time. */
function useSaveShortcut(save: () => Promise<void>) {
  const saveRef = useRef(save);
  saveRef.current = save;
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
}

function Card({
  title,
  note,
  children,
}: {
  title?: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="v-card">
      {title && (
        <div className="v-card__header">
          <h3 className="v-card__title">{title}</h3>
          {note && (
            <span className="v-muted" style={{ fontSize: 12.5 }}>
              {note}
            </span>
          )}
        </div>
      )}
      <div className="v-card__body">{children}</div>
    </div>
  );
}

function EditorActions({
  unsaved,
  previewHref,
  canDelete,
  onDelete,
  onSave,
  saving,
  saveDisabled,
  isNew,
}: {
  unsaved: boolean;
  previewHref: string | null;
  canDelete: boolean;
  onDelete: () => void;
  onSave: () => void;
  saving: boolean;
  saveDisabled: boolean;
  isNew: boolean;
}) {
  return (
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
      {canDelete && (
        <Button variant="danger" icon title="Delete" onClick={onDelete}>
          <Trash />
        </Button>
      )}
      <Button variant="primary" onClick={onSave} disabled={saveDisabled}>
        {saving ? <Spinner /> : <Save />} {isNew ? "Create" : "Save"}
        <span className="v-kbd">⌘S</span>
      </Button>
    </>
  );
}

function ErrorList({ errors }: { errors: ValidationError[] }) {
  return (
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
  );
}

function TitleCard({
  value,
  placeholder,
  onChange,
  autoFocus,
  error,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  autoFocus: boolean;
  error?: string;
}) {
  return (
    <div className="v-card">
      <div className="v-card__body" style={{ padding: "14px 18px" }}>
        <input
          className="v-title-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
        />
        {error && <div className="v-field__error">{error}</div>}
      </div>
    </div>
  );
}

function PublishCard({
  isPublished,
  onPublish,
  children,
}: {
  isPublished: boolean | null;
  /** Publishes or unpublishes; null without a status field. */
  onPublish: ((on: boolean) => void) | null;
  children: ReactNode;
}) {
  return (
    <div className="v-card">
      <div className="v-card__header">
        <h3 className="v-card__title">Publish</h3>
        {isPublished !== null && (
          <span style={{ marginLeft: "auto" }}>
            <Badge status={statusOf(isPublished)} />
          </span>
        )}
      </div>
      <div className="v-card__body v-stack">
        {onPublish && (
          <Toggle
            checked={isPublished ?? false}
            label={isPublished ? "Published" : "Draft"}
            onChange={onPublish}
          />
        )}
        {children}
      </div>
    </div>
  );
}

function SlugField({
  pattern,
  slug,
  box,
  onChange,
  error,
  hint,
}: {
  pattern: PathPattern;
  slug: string;
  box: { value: string; prefix: string };
  onChange: (value: string) => void;
  error: string | null;
  hint: string | null;
}) {
  return (
    <div>
      <label className="v-field__label">Slug</label>
      {pattern.single ? (
        <input className="v-input v-input--mono" readOnly value={slug} />
      ) : (
        <div className="v-slug">
          {box.prefix && (
            <span
              className="v-slug__prefix v-mono"
              title="Set by the date field"
            >
              {box.prefix}
            </span>
          )}
          <input
            className="v-input v-input--mono"
            value={box.value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="auto"
            aria-invalid={error ? true : undefined}
          />
        </div>
      )}
      {error && <div className="v-field__error">{error}</div>}
      {hint && (
        <div className="v-field__hint v-mono" style={{ fontSize: 11.5 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/** The entry's file, and the times its auto-updated fields hold. */
function EntryMeta({
  path,
  col,
  data,
}: {
  path: string;
  col: Entry;
  data: Record<string, unknown>;
}) {
  return (
    <dl className="v-meta">
      <dt>File</dt>
      <dd title={path}>{path}</dd>
      {Object.entries(col.schema)
        .filter(([, f]) => f.type === "datetime" && f.autoUpdate)
        .map(([k]) => (
          <span key={k} style={{ display: "contents" }}>
            <dt>{fieldLabel(k, col.schema[k])}</dt>
            <dd>{data[k] ? formatDate(data[k]) : "—"}</dd>
          </span>
        ))}
    </dl>
  );
}

function RenameDialog({
  references,
  busy,
  onCancel,
  onConfirm,
}: {
  references: EntryReference[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      title="Rename this entry?"
      message={
        <>
          {references.length === 1
            ? "1 other entry refers"
            : `${references.length} other entries refer`}{" "}
          to this one and will be updated in the same commit:
          <ul className="v-reference-list">
            {references.slice(0, 8).map((r) => (
              <li key={`${r.kind}:${r.key}:${r.slug}`}>
                {r.kind === "collection" ? `${r.label}: ${r.title}` : r.label}
              </li>
            ))}
            {references.length > 8 && <li>and {references.length - 8} more</li>}
          </ul>
        </>
      }
      confirmLabel="Rename and update"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

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
  useLayoutEffect,
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
  isEditable,
  isReadOnly,
  parsePathPattern,
  type PathPattern,
} from "../../core/paths.js";
import { filenameDateKey, rewriteReferences } from "../../core/values.js";
import { ApiError, type EntryDetail, type EntryReference } from "../api.js";
import type { PendingUpload } from "../components/AssetPicker.js";
import type { EditorEnv } from "../components/editor/EditorContext.js";
import { RichTextEditor } from "../components/editor/RichTextEditor.js";
import { CodeInput } from "../components/fields/CodeInput.js";
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
import { useFitToScrollport } from "../lib/fit-to-scrollport.js";
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
  rebaseDraft,
  effectiveSlug,
  entryDisplay,
  entryFile,
  readOnlySchema,
  fieldPlacement,
  publishToggle,
  type Kind,
  saveErrorMessage,
  saveInput,
  sectionFields,
  sendSave,
  slugBox,
  slugError,
  slugFixed,
  slugHint,
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
  const col = useVestry().config.collections?.[collection];
  // The API refuses a new entry here, so there is no form to fill in.
  if (col && !isEditable(col))
    return (
      <NotFoundState title={`New entries can't be added to ${col.label}`}>
        This collection doesn't allow creating entries.
      </NotFoundState>
    );
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
function EntryForm(props: EntryFormProps) {
  const form = useEntryForm(props);
  const { display, saving, remove } = form;
  return (
    <>
      <EntryTopBar form={form} />
      <div className="v-page">
        {form.errors.length > 0 && <ErrorList errors={form.errors} />}
        {form.readOnly && (
          <div style={{ marginBottom: 18 }}>
            <Alert kind="info">
              {`${form.col.label} are read-only here: they can be viewed, but not changed.`}
            </Alert>
          </div>
        )}
        <fieldset className="v-editor-fieldset" disabled={form.readOnly}>
          <div className="v-editor-layout">
            <EntryMain form={form} />
            <EntrySidebar form={form} />
          </div>
        </fieldset>
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
      {form.confirmDelete && (
        <DeleteDialog
          collectionKey={props.collectionKey}
          slug={props.slug!}
          title={display.titleValue}
          busy={remove.isPending}
          onCancel={() => form.setConfirmDelete(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
    </>
  );
}

interface EntryFormProps {
  kind: Kind;
  collectionKey: string;
  slug: string | null;
  isNew: boolean;
  col: Entry;
  entry?: EntryDetail;
  draft?: Draft;
}

/** Everything the editor's parts share: the document, its slug, saving and how it displays. */
function useEntryForm(props: EntryFormProps) {
  const { kind, collectionKey, slug, isNew, entry, draft } = props;
  const { config } = useVestry();
  const readOnly = kind === "collection" && isReadOnly(props.col);
  // Every field of a read-only collection shows as read-only.
  const col = useMemo(
    () =>
      readOnly
        ? { ...props.col, schema: readOnlySchema(props.col.schema) }
        : props.col,
    [readOnly, props.col],
  );
  const collection = kind === "collection" ? (col as CollectionConfig) : null;
  const doc = useDocument(col, entry, draft, readOnly);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pattern = useMemo(() => parsePathPattern(col.path), [col]);
  const slugs = useSlug({
    kind,
    collection,
    pattern,
    slug,
    isNew,
    state: doc.state,
    draft,
  });

  // Ask before leaving the page with anything unsaved, a rename included.
  const unsaved = doc.dirty || slugs.renaming;
  useLeaveWarning(unsaved);

  const filePath = entryFile(kind, col, pattern, slugs.finalSlug);
  // What the body was written for: its relative references follow the
  // file, so they are rewritten only when a save moves it.
  const openedFile = entryFile(kind, col, pattern, slug ?? "");
  const saving = useSave({
    kind,
    collectionKey,
    slug,
    isNew,
    col,
    pattern,
    filePath,
    openedFile,
    doc,
    slugs,
    setErrors,
    readOnly,
  });
  const remove = useRemove(collectionKey, slug);
  const display = entryDisplay({
    kind,
    col,
    data: doc.state.data,
    isNew,
    slug: slugs.finalSlug,
    siteUrl: config.siteUrl,
  });
  return {
    ...props,
    col,
    readOnly,
    collection,
    doc,
    errors,
    confirmDelete,
    setConfirmDelete,
    pattern,
    slugs,
    unsaved,
    filePath,
    openedFile,
    saving,
    remove,
    display,
    placement: fieldPlacement(col, display.editable),
    uploadCount: Object.keys(doc.uploads).length,
  };
}

type EntryFormModel = ReturnType<typeof useEntryForm>;

function EntryTopBar({ form }: { form: EntryFormModel }) {
  const { collection, display, isNew, saving, slugs, unsaved } = form;
  return (
    <TopBar
      status={
        display.isPublished === null ? null : statusOf(display.isPublished)
      }
      sticky
      crumbs={
        collection
          ? [
              {
                label: collection.label,
                to: `/collections/${form.collectionKey}`,
              },
            ]
          : undefined
      }
      title={
        isNew
          ? `New ${collection?.singular ?? "entry"}`
          : display.titleValue || slugs.finalSlug
      }
      actions={
        <EditorActions
          unsaved={unsaved}
          previewHref={display.previewHref}
          canDelete={form.slugs.deletable}
          readOnly={form.readOnly}
          onDelete={() => form.setConfirmDelete(true)}
          onSave={() => void saving.requestSave()}
          saving={saving.save.isPending}
          saveDisabled={
            saving.save.isPending ||
            !!slugs.error ||
            (!unsaved && !isNew && form.uploadCount === 0)
          }
          isNew={isNew}
        />
      }
    />
  );
}

/** The title, the body and the fields that aren't in the sidebar. */
function EntryMain({ form }: { form: EntryFormModel }) {
  const { col, display, placement, doc } = form;
  const titleKey = display.titleInput;
  return (
    <div className="v-stack" style={{ gap: 20 }}>
      {titleKey && (
        <TitleCard
          value={display.titleValue}
          placeholder={`${fieldLabel(titleKey, col.schema[titleKey])}…`}
          onChange={(title) =>
            doc.setData((data) => ({ ...data, [titleKey]: title }))
          }
          autoFocus={form.isNew}
          error={form.errors.find((e) => e.path === titleKey)?.message}
        />
      )}
      {placement.sections.map((section, i) =>
        section === "body" ? (
          <EntryBody key="body" form={form} />
        ) : section.sidebar ? null : (
          <SectionCard key={`section-${i}`} form={form} section={section} />
        ),
      )}
      {placement.hasVisible(placement.isMain) && (
        <Card title="Details">
          <EntryFields
            form={form}
            schema={col.schema}
            filter={placement.isMain}
          />
        </Card>
      )}
      {!placement.bodyPlaced && <EntryBody form={form} />}
    </div>
  );
}

/** Publishing, the slug, and the sidebar's fields. */
function EntrySidebar({ form }: { form: EntryFormModel }) {
  const { col, collection, display, placement, doc, slugs } = form;
  const ref = useRef<HTMLElement>(null);
  useFitToScrollport(ref);
  return (
    <aside ref={ref} className="v-editor-sidebar v-stack">
      {(display.statusField || collection) && (
        <PublishCard
          isPublished={display.isPublished}
          onPublish={publishToggle(display, doc.state.data, doc.setData)}
        >
          {collection && (
            <SlugField
              pattern={form.pattern}
              slug={slugs.finalSlug}
              box={slugs.box}
              fixed={slugs.fixed}
              onChange={slugs.setTyped}
              error={slugs.error}
              hint={slugHint(
                form.pattern,
                slugs.finalSlug,
                form.isNew,
                slugs.renaming,
              )}
            />
          )}
          {form.entry && (
            <EntryMeta path={form.entry.path} col={col} data={doc.state.data} />
          )}
        </PublishCard>
      )}
      {placement.sections.map((section, i) =>
        section !== "body" && section.sidebar ? (
          <SectionCard key={`section-${i}`} form={form} section={section} />
        ) : null,
      )}
      {placement.hasVisible(placement.isSidebar) && (
        <Card>
          <EntryFields
            form={form}
            schema={col.schema}
            filter={placement.isSidebar}
          />
        </Card>
      )}
      {form.uploadCount > 0 && <UploadsNote count={form.uploadCount} />}
    </aside>
  );
}

/** A configured section's fields in a card, unless none of them shows. */
function SectionCard({
  form,
  section,
}: {
  form: EntryFormModel;
  section: Exclude<EditorSection, "body">;
}) {
  const inSection = (key: string) =>
    section.fields.includes(key) && form.display.editable(key);
  if (!form.placement.hasVisible(inSection)) return null;
  const { schema, hideLabels } = sectionFields(form.col, section, fieldLabel);
  return (
    <Card title={section.label} note={section.description}>
      <EntryFields
        form={form}
        schema={schema}
        filter={inSection}
        hideLabels={hideLabels}
      />
    </Card>
  );
}

/** The entry's fields that pass `filter`, editing its data. */
function EntryFields({
  form,
  ...props
}: FieldSetProps & { form: EntryFormModel }) {
  const { doc } = form;
  return (
    <FieldSet
      {...props}
      values={doc.state.data}
      onChange={doc.setData}
      errors={form.errors}
      ctx={{
        addUpload: doc.addUpload,
        pendingUploads: doc.uploads,
        isNew: form.isNew,
        siblings: doc.state.data,
        filePath: form.openedFile,
      }}
    />
  );
}

function EntryBody({ form }: { form: EntryFormModel }) {
  const { config, api } = useVestry();
  if (form.readOnly)
    return <ReadOnlyBody col={form.col} body={form.doc.state.body} />;
  return (
    <BodyCard
      col={form.col}
      filePath={form.openedFile}
      config={config}
      fileUrl={api.fileUrl}
      doc={form.doc}
    />
  );
}

/** The format of entries' Markdown or MDX body, or null if they have none. */
function bodyFormat(col: Entry): "md" | "mdx" | null {
  const format = collectionFormat(col);
  return col.body !== false && (format === "md" || format === "mdx")
    ? format
    : null;
}

/** A read-only collection's body, as its Markdown source. */
function ReadOnlyBody({ col, body }: { col: Entry; body: string }) {
  if (!bodyFormat(col)) return null;
  return (
    <Card title={(col.body || undefined)?.label ?? "Content"}>
      <CodeInput
        value={body}
        onChange={() => {}}
        language="markdown"
        readOnly
      />
    </Card>
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
 * saved version. A read-only entry takes no changes, so nothing (a field
 * that seeds a value, a drag, typing in a rich text field) can leave it
 * unsaved.
 */
function useDocument(
  col: Entry,
  entry: EntryDetail | undefined,
  draft: Draft | undefined,
  readOnly: boolean,
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
  const change = useCallback(
    (update: (form: Form) => Form) => {
      if (readOnly) return;
      latest.current = update(latest.current);
      setForm(latest.current);
    },
    [readOnly],
  );
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
  /** Saving will move an existing entry to a different file. */
  const renaming =
    kind === "collection" && !isNew && !!finalSlug && finalSlug !== slug;
  // A new entry has no slug yet, so nothing about it is fixed.
  const fixed = slugFixed(collection, slug);
  return {
    finalSlug,
    /** Why the slug box is read-only, if it is. */
    fixed,
    /** An existing entry can be deleted where its slug could change. */
    deletable: collection !== null && slug !== null && fixed === null,
    dateKey,
    setTyped,
    latestTyped: () => latestTyped.current,
    box: slugBox(finalSlug, typed, dateKey),
    error: slugError({
      kind,
      collection,
      pattern,
      finalSlug,
      data: state.data,
      fixed,
      changing: isNew || renaming,
    }),
    renaming,
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
  openedFile,
  doc,
  slugs,
  setErrors,
  readOnly,
}: {
  kind: Kind;
  collectionKey: string;
  slug: string | null;
  isNew: boolean;
  col: Entry;
  pattern: PathPattern;
  filePath: string;
  openedFile: string;
  doc: Document;
  slugs: Slugs;
  setErrors: (errors: ValidationError[]) => void;
  readOnly: boolean;
}) {
  const { api, client, config } = useVestry();
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
        openedFile,
        config,
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
      void qc.invalidateQueries({ queryKey: ["entries", collectionKey] });
      void qc.invalidateQueries({ queryKey: ["assets"] });
      // The editor opens on what is cached, so the cache must not keep the
      // version from before this save.
      if (kind === "singleton") {
        void qc.invalidateQueries({ queryKey: ["singleton", collectionKey] });
        return;
      }
      if (!isNew && res.slug === slug) {
        void qc.invalidateQueries({ queryKey: ["entry", collectionKey, slug] });
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
      // What changed while it saved was written for the file it opened;
      // the data as saved (`res.data`) was moved by the save.
      handoff = draft && {
        key: draftKey(kind, collectionKey, res.slug),
        draft: rebaseDraft(
          draft,
          col,
          config,
          openedFile,
          entryFile(kind, col, pattern, res.slug),
          res.data,
        ),
      };
      void navigate(entryHref(collectionKey, res.slug), { replace: true });
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
    // shortcut pressed twice) must not start a second save. Nothing in a
    // read-only collection is saved, the shortcut included.
    if (readOnly || save.isPending || slugs.error || checkingReferences.current)
      return;
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
      void qc.invalidateQueries({ queryKey: ["entries", collectionKey] });
      // Not to be opened again from the cache.
      qc.removeQueries({ queryKey: ["entry", collectionKey, slug] });
      void navigate(`/collections/${collectionKey}`);
    },
    onError: (e) => toast("error", e.message),
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
  const format = bodyFormat(col);
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
  if (!body || !format) return null;
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
  readOnly,
  onDelete,
  onSave,
  saving,
  saveDisabled,
  isNew,
}: {
  unsaved: boolean;
  previewHref: string | null;
  canDelete: boolean;
  readOnly: boolean;
  onDelete: () => void;
  onSave: () => void;
  saving: boolean;
  saveDisabled: boolean;
  isNew: boolean;
}) {
  return (
    <>
      {unsaved && (
        <span className="v-unsaved" title="Unsaved changes">
          <TriangleExclamationPoint size={13} />{" "}
          <span className="v-unsaved__text">Unsaved changes</span>
        </span>
      )}
      {previewHref && (
        <a
          className="v-btn"
          href={previewHref}
          target="_blank"
          rel="noreferrer"
          title="View on the site"
        >
          <ExternalLink /> <span className="v-btn__label">View</span>
        </a>
      )}
      {canDelete && (
        <Button variant="danger" icon title="Delete" onClick={onDelete}>
          <Trash />
        </Button>
      )}
      {readOnly ? (
        <Badge>Read-only</Badge>
      ) : (
        <Button variant="primary" onClick={onSave} disabled={saveDisabled}>
          {saving ? <Spinner /> : <Save />} {isNew ? "Create" : "Save"}
          <span className="v-kbd">⌘S</span>
        </Button>
      )}
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
        <TitleInput
          value={value}
          placeholder={placeholder}
          onChange={onChange}
          autoFocus={autoFocus}
        />
        {error && <div className="v-field__error">{error}</div>}
      </div>
    </div>
  );
}

/**
 * The title, wrapping onto more lines rather than running out of sight in a
 * narrow window. A title is one line: Enter and pasted line breaks become
 * nothing and spaces.
 */
function TitleInput({
  value,
  placeholder,
  onChange,
  autoFocus,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  autoFocus: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Grows with its text (CSS `field-sizing: content` where supported).
  useLayoutEffect(() => fitHeight(ref.current), [value]);
  // A narrower card wraps the title onto more lines. The refit waits for
  // the next frame: resizing the card inside the observer's own callback
  // would raise a "ResizeObserver loop" error.
  useEffect(() => {
    const el = ref.current;
    const card = el?.parentElement;
    if (!card || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitHeight(el));
    });
    observer.observe(card);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return (
    <textarea
      ref={ref}
      className="v-title-input"
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(oneLine(e.target))}
      onKeyDown={(e) => {
        // An Enter that ends an input method's composition is left to it.
        if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
      }}
      autoFocus={autoFocus}
    />
  );
}

/** Sets a textarea's height to its text's. */
function fitHeight(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

const LINE_BREAKS = /\s*[\r\n]+\s*/g;

/**
 * The field's text with its line breaks made spaces. When there were some
 * (a paste), the field is rewritten here with the caret kept where it was;
 * left to React, the new value would put the caret at the end.
 */
function oneLine(el: HTMLTextAreaElement) {
  const text = el.value.replace(LINE_BREAKS, " ");
  if (text !== el.value) {
    const caret = el.value
      .slice(0, el.selectionEnd)
      .replace(LINE_BREAKS, " ").length;
    el.value = text;
    el.setSelectionRange(caret, caret);
  }
  return text;
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
  fixed,
  onChange,
  error,
  hint,
}: {
  pattern: PathPattern;
  slug: string;
  box: { value: string; prefix: string };
  /** Why the slug can't change, if it can't. */
  fixed: string | null;
  onChange: (value: string) => void;
  error: string | null;
  hint: string | null;
}) {
  return (
    <div>
      <label className="v-field__label">Slug</label>
      {pattern.single || fixed ? (
        <input
          className="v-input v-input--mono"
          readOnly
          value={slug}
          // The error and the reason it is fixed never show together.
          aria-describedby={error || fixed ? "v-slug-note" : undefined}
        />
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
      {error && (
        <div id="v-slug-note" className="v-field__error">
          {error}
        </div>
      )}
      {fixed && !error && (
        <div id="v-slug-note" className="v-field__hint">
          {fixed}
        </div>
      )}
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

/** Entries that refer to one, at most eight of them by name. */
function ReferenceList({ references }: { references: EntryReference[] }) {
  return (
    <ul className="v-reference-list">
      {references.slice(0, 8).map((r) => (
        <li key={`${r.kind}:${r.key}:${r.slug}`}>
          {r.kind === "collection" ? `${r.label}: ${r.title}` : r.label}
        </li>
      ))}
      {references.length > 8 && <li>and {references.length - 8} more</li>}
    </ul>
  );
}

const referCount = (n: number) =>
  n === 1 ? "1 other entry refers" : `${n} other entries refer`;

/**
 * Confirms a deletion, first looking up the entries that refer to this one,
 * whose references would then point at nothing.
 */
function DeleteDialog({
  collectionKey,
  slug,
  title,
  busy,
  onCancel,
  onConfirm,
}: {
  collectionKey: string;
  slug: string;
  title: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { api } = useVestry();
  const lookup = useQuery({
    queryKey: ["references", collectionKey, slug],
    queryFn: () => api.references(collectionKey, slug),
    staleTime: 0,
    gcTime: 0,
  });
  const references = lookup.data?.references ?? [];
  const removed =
    "The file will be removed from the repository in a new commit.";
  return (
    <ConfirmDialog
      title={`Delete “${title}”?`}
      message={
        lookup.isPending ? (
          "Checking for entries that refer to it…"
        ) : references.length ? (
          <>
            {referCount(references.length)} to this one, and would then point at
            an entry that no longer exists:
            <ReferenceList references={references} />
            {removed}
          </>
        ) : (
          <>
            {lookup.isError &&
              "The entries that refer to it couldn't be checked. "}
            {removed}
          </>
        )
      }
      confirmLabel={references.length ? "Delete anyway" : "Delete"}
      danger
      busy={busy}
      confirmDisabled={lookup.isPending}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
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
          {referCount(references.length)} to this one and will be updated in the
          same commit:
          <ReferenceList references={references} />
        </>
      }
      confirmLabel="Rename and update"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

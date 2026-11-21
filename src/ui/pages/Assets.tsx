import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Search, Trash } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import type { AssetContainerConfig } from "../../config/types.js";
import { joinPath } from "../../core/paths.js";
import type { AssetItem } from "../../core/service.js";
import {
  AssetCrumbs,
  AssetGrid,
  AssetTable,
  Dropzone,
  FolderGrid,
  UploadButton,
  uploadedMessage,
  uploadPayload,
} from "../components/AssetBrowser.js";
import { Icon } from "../components/Icon.js";
import { TopBar } from "../components/Layout.js";
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  Loading,
  Modal,
  NotFoundState,
  Segment,
  useToast,
} from "../components/ui.js";
import { useVestry } from "../context.js";
import {
  type AssetSort,
  matchAssets,
  nextAssetSort,
  sortAssets,
} from "../lib/asset-list.js";
import { useStoredState } from "../lib/stored-state.js";
import { formatBytes, IMAGE_EXTENSIONS } from "../lib/utils.js";

type View = "grid" | "list";
const VIEWS = ["grid", "list"] as const;
const isView = (v: unknown): v is View => v === "grid" || v === "list";

/**
 * A folder that takes only documents (PDFs, say) opens as a list, where long
 * names show whole; one that takes images, or anything, as tiles.
 */
function defaultView(container?: AssetContainerConfig): View {
  const accept = container?.accept;
  if (!accept?.length) return "grid";
  return accept.some((ext) => IMAGE_EXTENSIONS.includes(ext.toLowerCase()))
    ? "grid"
    : "list";
}

export function AssetsPage() {
  const { container: key = "" } = useParams();
  const { config } = useVestry();
  const container = config.assets?.[key];
  const [params, setParams] = useSearchParams();
  const dir = params.get("dir") ?? "";
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useStoredState<View>(
    `vestry:asset-view:${key}`,
    defaultView(container),
    isView,
  );
  const q = useAssetListing(key, dir, Boolean(container), search);
  const upload = useUpload(key, dir);

  if (!container)
    return <NotFoundState title={`No asset folder called “${key}”`} />;
  const navigate = (path: string) => setParams(path ? { dir: path } : {});
  const selectedItem = q.data?.items.find((i) => i.path === selected);

  return (
    <>
      <TopBar
        title={container.label}
        actions={
          <UploadButton
            variant="primary"
            accept={container.accept}
            busy={upload.isPending}
            onFiles={(files) => upload.mutate(files)}
          />
        }
      />
      <div className="v-page">
        <div className="v-toolbar">
          <AssetCrumbs
            root={container.directory}
            path={dir}
            onNavigate={navigate}
          />
        </div>
        <AssetFilters
          search={search}
          onSearch={setSearch}
          view={view}
          onView={setView}
        />
        <Dropzone onFiles={(files) => upload.mutate(files)}>
          Drop files here to upload to{" "}
          <span className="v-mono">{joinPath(container.directory, dir)}</span>
        </Dropzone>
        {q.isLoading && <Loading />}
        {q.error && <Alert kind="error">{q.error.message}</Alert>}
        {q.data && (
          <AssetsListing
            listing={q.data}
            pending={q.isPlaceholderData}
            base={joinPath(container.directory, dir)}
            view={view}
            search={search}
            emptyIcon={container.icon ?? "image"}
            selected={selected}
            onSelect={setSelected}
            onOpenFolder={(f) => navigate(joinPath(dir, f))}
          />
        )}
      </div>
      {selectedItem && (
        <AssetDetails
          containerKey={key}
          item={selectedItem}
          publicDir={container.directory.startsWith("public/")}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

/**
 * The files and folders in `dir`, or while searching every file below it,
 * for the search to filter as it's typed.
 */
function useAssetListing(
  key: string,
  dir: string,
  enabled: boolean,
  search: string,
) {
  const { api } = useVestry();
  const all = search.trim() !== "";
  return useQuery({
    queryKey: ["assets", key, dir, all ? "all" : "folder"],
    queryFn: () => api.listAssets(key, dir, { all }),
    enabled,
    // Typing the first letter keeps the folder on screen until the
    // matches arrive. Another folder's or container's files never stand in.
    placeholderData: (previous, previousQuery) =>
      all &&
      previousQuery?.queryKey[1] === key &&
      previousQuery.queryKey[2] === dir
        ? previous
        : undefined,
  });
}

function AssetFilters({
  search,
  onSearch,
  view,
  onView,
}: {
  search: string;
  onSearch: (search: string) => void;
  view: View;
  onView: (view: View) => void;
}) {
  return (
    <div className="v-toolbar">
      <div className="v-search">
        <Search />
        <input
          className="v-input"
          type="search"
          aria-label="Search files"
          placeholder="Search file names…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <Segment label="View" options={VIEWS} value={view} onChange={onView} />
    </div>
  );
}

/** Uploads files into `dir` of the container, reporting how it went. */
function useUpload(key: string, dir: string) {
  const { api } = useVestry();
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]) =>
      api.uploadAssets(key, dir, await uploadPayload(files)),
    onSuccess: (res) => {
      toast("success", uploadedMessage(res.paths.length));
      void qc.invalidateQueries({ queryKey: ["assets", key] });
    },
    onError: (e) => toast("error", e.message),
  });
}

function AssetsListing({
  listing,
  pending,
  base,
  view,
  search,
  emptyIcon,
  selected,
  onSelect,
  onOpenFolder,
}: {
  listing: { items: AssetItem[]; folders: string[] };
  /** `listing` is the folder's own, standing in until a search's arrives. */
  pending: boolean;
  /** The folder shown, from the repository root. */
  base: string;
  view: View;
  search: string;
  emptyIcon: string;
  selected: string | null;
  onSelect: (path: string) => void;
  onOpenFolder: (folder: string) => void;
}) {
  const [sort, setSort] = useState<AssetSort>({ field: "name", dir: "asc" });
  const searching = search.trim() !== "";
  // A search shows matching files only, from this folder and those below.
  const folders = searching ? [] : listing.folders;
  const items = useMemo(
    () => sortAssets(matchAssets(listing.items, search, base), sort),
    [listing.items, search, base, sort],
  );
  // No match in the folder itself yet says nothing about those below it.
  if (items.length === 0 && folders.length === 0)
    return pending ? (
      <Loading />
    ) : (
      <NoAssets searching={searching} emptyIcon={emptyIcon} />
    );
  if (view === "list")
    return (
      <div className="v-card">
        <AssetTable
          folders={folders}
          items={items}
          base={base}
          sort={sort}
          onSort={(field) => setSort((s) => nextAssetSort(s, field))}
          onSelect={onSelect}
          onOpenFolder={onOpenFolder}
        />
        <div className="v-table__footer">
          {fileCount(items.length, listing.items.length, searching)}
        </div>
      </div>
    );
  return (
    <>
      <FolderGrid folders={folders} onOpen={onOpenFolder} />
      <AssetGrid
        items={items}
        base={base}
        selected={selected}
        onSelect={onSelect}
      />
    </>
  );
}

/** "3 files", or while searching "3 of 240 files". */
function fileCount(shown: number, total: number, searching: boolean): string {
  const noun = total === 1 ? "file" : "files";
  return searching ? `${shown} of ${total} ${noun}` : `${total} ${noun}`;
}

function NoAssets({
  searching,
  emptyIcon,
}: {
  searching: boolean;
  emptyIcon: string;
}) {
  if (searching)
    return (
      <EmptyState icon={<Search />} title="No matches">
        <p>No file names in this folder or the folders inside it match.</p>
      </EmptyState>
    );
  return (
    <EmptyState icon={<Icon name={emptyIcon} />} title="No files here yet">
      <p>
        Upload files with the button above
        <span className="v-drop-hint"> or drop them onto this page</span>.
      </p>
    </EmptyState>
  );
}

/** The selected file: a preview, its path and URL, and a way to delete it. */
function AssetDetails({
  containerKey,
  item,
  publicDir,
  onClose,
}: {
  containerKey: string;
  item: AssetItem;
  /** Whether the container is under `public/`, so the file has a URL. */
  publicDir: boolean;
  onClose: () => void;
}) {
  const { api } = useVestry();
  const toast = useToast();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.deleteAsset(containerKey, item.path),
    onSuccess: () => {
      toast("success", "File deleted");
      onClose();
      void qc.invalidateQueries({ queryKey: ["assets", containerKey] });
    },
    onError: (e) => toast("error", e.message),
  });
  return (
    <>
      <Modal
        title={item.name}
        onClose={onClose}
        footer={
          <>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              <Trash /> Delete
            </Button>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(item.path);
                  toast("success", "Path copied");
                } catch {
                  // Refused, or no clipboard outside a secure context.
                  toast("error", "Couldn't copy the path");
                }
              }}
            >
              <Copy /> Copy path
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        {item.kind === "image" && (
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <img
              src={api.fileUrl(item.path, item.sha)}
              alt=""
              style={{ maxWidth: "100%", maxHeight: 360, borderRadius: 6 }}
            />
          </div>
        )}
        <dl className="v-meta">
          <dt>Path</dt>
          <dd className="v-mono">{item.path}</dd>
          <dt>Size</dt>
          <dd>{formatBytes(item.size)}</dd>
          {publicDir && (
            <>
              <dt>URL</dt>
              <dd className="v-mono">/{item.path.slice("public/".length)}</dd>
            </>
          )}
        </dl>
      </Modal>
      {confirming && (
        <ConfirmDialog
          title="Delete file?"
          message={
            <>
              <span className="v-mono">{item.path}</span> will be removed from
              the repository. Pages that reference it will break.
            </>
          }
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
    </>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { joinPath } from "../../core/paths.js";
import type { AssetItem } from "../../core/service.js";
import {
  AssetCrumbs,
  AssetGrid,
  Dropzone,
  FolderGrid,
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
  Spinner,
  useToast,
} from "../components/ui.js";
import { useVestry } from "../context.js";
import { formatBytes } from "../lib/utils.js";

export function AssetsPage() {
  const { container: key = "" } = useParams();
  const { config, api } = useVestry();
  const container = config.assets?.[key];
  const [params, setParams] = useSearchParams();
  const dir = params.get("dir") ?? "";
  const [selected, setSelected] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["assets", key, dir],
    queryFn: () => api.listAssets(key, dir),
    enabled: Boolean(container),
  });

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
        <Dropzone onFiles={(files) => upload.mutate(files)}>
          Drop files here to upload to{" "}
          <span className="v-mono">{joinPath(container.directory, dir)}</span>
        </Dropzone>
        {q.isLoading && <Loading />}
        {q.error && <Alert kind="error">{(q.error as Error).message}</Alert>}
        {q.data && (
          <AssetsListing
            listing={q.data}
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
      qc.invalidateQueries({ queryKey: ["assets", key] });
    },
    onError: (e) => toast("error", (e as Error).message),
  });
}

function AssetsListing({
  listing,
  emptyIcon,
  selected,
  onSelect,
  onOpenFolder,
}: {
  listing: { items: AssetItem[]; folders: string[] };
  emptyIcon: string;
  selected: string | null;
  onSelect: (path: string) => void;
  onOpenFolder: (folder: string) => void;
}) {
  return (
    <>
      <FolderGrid folders={listing.folders} onOpen={onOpenFolder} />
      {listing.items.length === 0 && listing.folders.length === 0 ? (
        <EmptyState icon={<Icon name={emptyIcon} />} title="No files here yet">
          <p>Upload files with the button above or drop them onto this page.</p>
        </EmptyState>
      ) : (
        <AssetGrid
          items={listing.items}
          selected={selected}
          onSelect={onSelect}
        />
      )}
    </>
  );
}

/** A hidden file input and the button that opens it. */
function UploadButton({
  accept,
  busy,
  onFiles,
}: {
  accept?: string[];
  busy: boolean;
  onFiles: (files: File[]) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept={accept?.map((a) => `.${a}`).join(",")}
        onChange={(e) => e.target.files && onFiles(Array.from(e.target.files))}
      />
      <Button
        variant="primary"
        onClick={() => fileInput.current?.click()}
        disabled={busy}
      >
        {busy ? <Spinner /> : <Upload />} Upload
      </Button>
    </>
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
      qc.invalidateQueries({ queryKey: ["assets", containerKey] });
    },
    onError: (e) => toast("error", (e as Error).message),
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
              onClick={() => {
                navigator.clipboard.writeText(item.path);
                toast("success", "Path copied");
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

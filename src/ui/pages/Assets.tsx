import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Copy,
  File as FileIcon,
  Folder,
  Trash,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { fileToBase64 } from "../api.js";
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
import { cx, formatBytes } from "../lib/utils.js";

export function AssetsPage() {
  const { container: key = "" } = useParams();
  const { config, api } = useVestry();
  const container = config.assets?.[key];
  const [params, setParams] = useSearchParams();
  const dir = params.get("dir") ?? "";
  const toast = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const q = useQuery({
    queryKey: ["assets", key, dir],
    queryFn: () => api.listAssets(key, dir),
    enabled: Boolean(container),
  });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const payload = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          base64: await fileToBase64(f),
        })),
      );
      return api.uploadAssets(key, dir, payload);
    },
    onSuccess: (res) => {
      toast(
        "success",
        `Uploaded ${res.paths.length} file${res.paths.length === 1 ? "" : "s"}`,
      );
      qc.invalidateQueries({ queryKey: ["assets", key] });
    },
    onError: (e) => toast("error", (e as Error).message),
  });

  const remove = useMutation({
    mutationFn: (path: string) => api.deleteAsset(key, path),
    onSuccess: () => {
      toast("success", "File deleted");
      setConfirmDelete(null);
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["assets", key] });
    },
    onError: (e) => toast("error", (e as Error).message),
  });

  if (!container)
    return <NotFoundState title={`No asset folder called “${key}”`} />;
  const crumbs = dir ? dir.split("/") : [];
  const selectedItem = q.data?.items.find((i) => i.path === selected);

  return (
    <>
      <TopBar
        title={container.label}
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept={container.accept?.map((a) => `.${a}`).join(",")}
              onChange={(e) =>
                e.target.files && upload.mutate(Array.from(e.target.files))
              }
            />
            <Button
              variant="primary"
              onClick={() => fileInput.current?.click()}
              disabled={upload.isPending}
            >
              {upload.isPending ? <Spinner /> : <Upload />} Upload
            </Button>
          </>
        }
      />
      <div className="v-page">
        <div className="v-toolbar">
          <div className="v-breadcrumbs">
            <button type="button" onClick={() => setParams({})}>
              {container.directory}
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="v-row" style={{ gap: 6 }}>
                <ChevronRight size={14} />
                <button
                  type="button"
                  onClick={() =>
                    setParams({ dir: crumbs.slice(0, i + 1).join("/") })
                  }
                >
                  {c}
                </button>
              </span>
            ))}
          </div>
        </div>
        <div
          className={cx("v-dropzone", over && "is-over")}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (e.dataTransfer.files.length)
              upload.mutate(Array.from(e.dataTransfer.files));
          }}
        >
          Drop files here to upload to{" "}
          <span className="v-mono">
            {[container.directory, dir].filter(Boolean).join("/")}
          </span>
        </div>
        {q.isLoading && <Loading />}
        {q.error && <Alert kind="error">{(q.error as Error).message}</Alert>}
        {q.data && (
          <>
            {q.data.folders.length > 0 && (
              <div className="v-asset-grid" style={{ marginBottom: 14 }}>
                {q.data.folders.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="v-folder"
                    onClick={() =>
                      setParams({ dir: [dir, f].filter(Boolean).join("/") })
                    }
                  >
                    <Folder /> {f}
                  </button>
                ))}
              </div>
            )}
            {q.data.items.length === 0 && q.data.folders.length === 0 ? (
              <EmptyState
                icon={<Icon name={container.icon ?? "image"} />}
                title="No files here yet"
              >
                <p>
                  Upload files with the button above or drop them onto this
                  page.
                </p>
              </EmptyState>
            ) : (
              <div className="v-asset-grid">
                {q.data.items.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    className={cx(
                      "v-asset",
                      selected === item.path && "is-selected",
                    )}
                    onClick={() => setSelected(item.path)}
                  >
                    <div className="v-asset__preview">
                      {item.kind === "image" ? (
                        <img
                          src={api.fileUrl(item.path, item.sha)}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <FileIcon />
                      )}
                    </div>
                    <div className="v-asset__name" title={item.name}>
                      {item.name}
                    </div>
                    <div className="v-asset__meta">
                      {formatBytes(item.size)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {selectedItem && (
        <Modal
          title={selectedItem.name}
          onClose={() => setSelected(null)}
          footer={
            <>
              <Button
                variant="danger"
                onClick={() => setConfirmDelete(selectedItem.path)}
              >
                <Trash /> Delete
              </Button>
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(selectedItem.path);
                  toast("success", "Path copied");
                }}
              >
                <Copy /> Copy path
              </Button>
              <Button variant="primary" onClick={() => setSelected(null)}>
                Done
              </Button>
            </>
          }
        >
          {selectedItem.kind === "image" && (
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <img
                src={api.fileUrl(selectedItem.path, selectedItem.sha)}
                alt=""
                style={{ maxWidth: "100%", maxHeight: 360, borderRadius: 6 }}
              />
            </div>
          )}
          <dl className="v-meta">
            <dt>Path</dt>
            <dd className="v-mono">{selectedItem.path}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(selectedItem.size)}</dd>
            {container.directory.startsWith("public/") && (
              <>
                <dt>URL</dt>
                <dd className="v-mono">
                  /{selectedItem.path.slice("public/".length)}
                </dd>
              </>
            )}
          </dl>
        </Modal>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete file?"
          message={
            <>
              <span className="v-mono">{confirmDelete}</span> will be removed
              from the repository. Pages that reference it will break.
            </>
          }
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => remove.mutate(confirmDelete)}
        />
      )}
    </>
  );
}

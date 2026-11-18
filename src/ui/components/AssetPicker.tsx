import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, File as FileIcon, Folder, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { safeFileName } from "../../core/paths.js";
import { fileToBase64 } from "../api.js";
import { useVestry } from "../context.js";
import { cx, formatBytes } from "../lib/utils.js";
import { Alert, Button, Loading, Modal, Spinner, useToast } from "./ui.js";

/**
 * Browse (and upload to) a repository directory and pick a file. Used by
 * image/file fields and the editor's image button.
 */
export function AssetPicker({
  directory,
  accept,
  allowUpload = true,
  onPick,
  onClose,
  title = "Choose a file",
  /** Instead of committing immediately, hand uploads back to the caller (saved with the entry). */
  deferUploads,
}: {
  directory: string;
  accept?: string[];
  allowUpload?: boolean;
  onPick: (
    path: string,
    pending?: { path: string; base64: string; previewUrl: string },
  ) => void;
  onClose: () => void;
  title?: string;
  deferUploads?: boolean;
}) {
  const { api, config } = useVestry();
  const toast = useToast();
  const qc = useQueryClient();
  const [subdir, setSubdir] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Find a configured container whose directory contains this one so the
  // API authorises the listing; fall back to an ad-hoc listing by directory.
  const containerKey =
    Object.entries(config.assets ?? {}).find(
      ([, c]) =>
        directory === c.directory || directory.startsWith(`${c.directory}/`),
    )?.[0] ?? null;
  const containerDir = containerKey
    ? config.assets![containerKey].directory
    : directory;
  const baseSub = directory.slice(containerDir.length).replace(/^\//, "");
  const dir = [baseSub, subdir].filter(Boolean).join("/");

  const query = useQuery({
    queryKey: ["assets", containerKey ?? directory, dir],
    queryFn: () => api.listAssets(containerKey ?? "", dir),
    enabled: containerKey !== null,
  });

  async function upload(files: FileList | File[]) {
    const list = Array.from(files).filter(
      (f) => !accept || accept.includes(f.name.split(".").pop()!.toLowerCase()),
    );
    if (!list.length) {
      toast("error", "That file type isn't accepted here.");
      return;
    }
    setUploading(true);
    try {
      if (deferUploads) {
        const f = list[0];
        const base64 = await fileToBase64(f);
        const name = safeFileName(f.name);
        const path = `${[containerDir, dir].filter(Boolean).join("/")}/${name}`;
        onPick(path, { path, base64, previewUrl: URL.createObjectURL(f) });
        return;
      }
      const payload = await Promise.all(
        list.map(async (f) => ({
          name: f.name,
          base64: await fileToBase64(f),
        })),
      );
      const res = await api.uploadAssets(containerKey!, dir, payload);
      await qc.invalidateQueries({
        queryKey: ["assets", containerKey ?? directory],
      });
      toast(
        "success",
        `Uploaded ${res.paths.length} file${res.paths.length === 1 ? "" : "s"}`,
      );
      if (res.paths.length === 1) {
        onPick(res.paths[0]);
      }
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const crumbs = subdir ? subdir.split("/") : [];

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!selected}
            onClick={() => selected && onPick(selected)}
          >
            Choose
          </Button>
        </>
      }
    >
      {!containerKey && (
        <Alert kind="warning">
          No asset container covers <code>{directory}</code>. Add one under{" "}
          <code>assets</code> in the Vestry config to browse it.
        </Alert>
      )}
      {containerKey && (
        <>
          <div className="v-row" style={{ marginBottom: 14 }}>
            <div className="v-breadcrumbs">
              <button type="button" onClick={() => setSubdir("")}>
                {directory}
              </button>
              {crumbs.map((c, i) => (
                <span key={i} className="v-row" style={{ gap: 6 }}>
                  <ChevronRight size={14} />
                  <button
                    type="button"
                    onClick={() => setSubdir(crumbs.slice(0, i + 1).join("/"))}
                  >
                    {c}
                  </button>
                </span>
              ))}
            </div>
            <div className="v-grow" />
            {allowUpload && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  multiple={!deferUploads}
                  accept={accept?.map((a) => `.${a}`).join(",")}
                  onChange={(e) => {
                    if (e.target.files) void upload(e.target.files);
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? <Spinner /> : <Upload />} Upload
                </Button>
              </>
            )}
          </div>
          {allowUpload && (
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
                  void upload(e.dataTransfer.files);
              }}
            >
              Drop files here to upload{accept ? ` (${accept.join(", ")})` : ""}
            </div>
          )}
          {query.isLoading && <Loading />}
          {query.error && <Alert kind="error">{query.error.message}</Alert>}
          {query.data && (
            <>
              {query.data.folders.length > 0 && (
                <div className="v-asset-grid" style={{ marginBottom: 14 }}>
                  {query.data.folders.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className="v-folder"
                      onClick={() =>
                        setSubdir([subdir, f].filter(Boolean).join("/"))
                      }
                    >
                      <Folder /> {f}
                    </button>
                  ))}
                </div>
              )}
              <div className="v-asset-grid">
                {query.data.items
                  .filter((i) => !accept || accept.includes(i.ext))
                  .map((item) => (
                    <button
                      key={item.path}
                      type="button"
                      className={cx(
                        "v-asset",
                        selected === item.path && "is-selected",
                      )}
                      onClick={() => setSelected(item.path)}
                      onDoubleClick={() => onPick(item.path)}
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
              {query.data.items.length === 0 &&
                query.data.folders.length === 0 && (
                  <p
                    className="v-muted"
                    style={{ textAlign: "center", padding: 24 }}
                  >
                    This folder is empty.
                  </p>
                )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}

export type PendingUpload = {
  path: string;
  base64: string;
  previewUrl: string;
};

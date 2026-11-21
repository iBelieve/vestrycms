import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { joinPath, safeFileName } from "../../core/paths.js";
import type { VestryConfig } from "../../config/types.js";
import type { AssetItem } from "../../core/service.js";
import { fileToBase64 } from "../api.js";
import {
  AssetCrumbs,
  AssetGrid,
  Dropzone,
  FolderGrid,
  UploadButton,
  uploadedMessage,
  uploadPayload,
} from "./AssetBrowser.js";
import { useVestry } from "../context.js";
import { Alert, Button, Loading, Modal, useToast } from "./ui.js";

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
  onPick: (path: string, pending?: PendingUpload) => void;
  onClose: () => void;
  title?: string;
  deferUploads?: boolean;
}) {
  const { api, config } = useVestry();
  const [subdir, setSubdir] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const { containerKey, containerDir } = containerFor(config, directory);
  const dir = joinPath(
    directory.slice(containerDir.length).replace(/^\//, ""),
    subdir,
  );

  const query = useQuery({
    queryKey: ["assets", containerKey ?? directory, dir],
    queryFn: () => api.listAssets(containerKey ?? "", dir),
    enabled: containerKey !== null,
  });
  const { upload, uploading } = usePickerUpload({
    containerKey,
    target: { dir, path: joinPath(containerDir, dir) },
    accept,
    deferUploads,
    onPick,
  });

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
      {containerKey ? (
        <>
          <div className="v-row" style={{ marginBottom: 14 }}>
            <AssetCrumbs
              root={directory}
              path={subdir}
              onNavigate={setSubdir}
            />
            <div className="v-grow" />
            {allowUpload && (
              <UploadButton
                size="sm"
                accept={accept}
                multiple={!deferUploads}
                busy={uploading}
                onFiles={upload}
              />
            )}
          </div>
          {allowUpload && (
            <Dropzone onFiles={upload}>
              <span className="v-drop-hint">Drop files here to upload</span>
              {accept && (
                <span className="v-drop-accept">
                  <span className="v-drop-hint"> (</span>
                  {accept.join(", ")}
                  <span className="v-drop-hint">)</span>
                </span>
              )}
            </Dropzone>
          )}
          <PickerListing
            query={query}
            accept={accept}
            selected={selected}
            onSelect={setSelected}
            onOpenFolder={(f) => setSubdir(joinPath(subdir, f))}
            onPick={(path) => onPick(path)}
          />
        </>
      ) : (
        <Alert kind="warning">
          No asset container covers <code>{directory}</code>. Add one under{" "}
          <code>assets</code> in the Vestry config to browse it.
        </Alert>
      )}
    </Modal>
  );
}

/**
 * Uploads dropped or chosen files of an accepted type into `target`: at once
 * (picking the file if there was one), or with `deferUploads` handing the
 * first back to `onPick` to save with the entry.
 */
function usePickerUpload({
  containerKey,
  target,
  accept,
  deferUploads,
  onPick,
}: {
  containerKey: string | null;
  /** The folder, within the container and as a repository path. */
  target: { dir: string; path: string };
  accept?: string[];
  deferUploads?: boolean;
  onPick: (path: string, pending?: PendingUpload) => void;
}) {
  const { api } = useVestry();
  const toast = useToast();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);

  async function deferred(f: File) {
    const base64 = await fileToBase64(f);
    const path = `${target.path}/${safeFileName(f.name)}`;
    onPick(path, { path, base64, previewUrl: URL.createObjectURL(f) });
  }

  async function commit(files: File[]) {
    const res = await api.uploadAssets(
      containerKey!,
      target.dir,
      await uploadPayload(files),
    );
    await qc.invalidateQueries({ queryKey: ["assets", containerKey] });
    toast("success", uploadedMessage(res.paths.length));
    if (res.paths.length === 1) onPick(res.paths[0]);
  }

  async function upload(files: File[]) {
    const list = files.filter(
      (f) => !accept || accept.includes(f.name.split(".").pop()!.toLowerCase()),
    );
    if (!list.length) {
      toast("error", "That file type isn't accepted here.");
      return;
    }
    setUploading(true);
    try {
      await (deferUploads ? deferred(list[0]) : commit(list));
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading };
}

/** The folder's subfolders and accepted files, or why they aren't shown. */
function PickerListing({
  query,
  accept,
  selected,
  onSelect,
  onOpenFolder,
  onPick,
}: {
  query: {
    isLoading: boolean;
    error: unknown;
    data?: { items: AssetItem[]; folders: string[] };
  };
  accept?: string[];
  selected: string | null;
  onSelect: (path: string) => void;
  onOpenFolder: (folder: string) => void;
  onPick: (path: string) => void;
}) {
  if (query.isLoading) return <Loading />;
  // A failed refetch keeps the listing it had, so show both.
  const error = query.error ? (
    <Alert kind="error">{(query.error as Error).message}</Alert>
  ) : null;
  const listing = query.data;
  if (!listing) return error;
  const empty = listing.items.length === 0 && listing.folders.length === 0;
  return (
    <>
      {error}
      <FolderGrid folders={listing.folders} onOpen={onOpenFolder} />
      <AssetGrid
        items={listing.items.filter((i) => !accept || accept.includes(i.ext))}
        selected={selected}
        onSelect={onSelect}
        onOpen={onPick}
      />
      {empty && (
        <p className="v-muted" style={{ textAlign: "center", padding: 24 }}>
          This folder is empty.
        </p>
      )}
    </>
  );
}

/**
 * The configured container whose directory holds `directory`, so the API
 * authorises the listing, or null (and `directory` itself) when none does.
 */
function containerFor(
  config: VestryConfig,
  directory: string,
): { containerKey: string | null; containerDir: string } {
  const found = Object.entries(config.assets ?? {}).find(
    ([, c]) =>
      directory === c.directory || directory.startsWith(`${c.directory}/`),
  );
  return found
    ? { containerKey: found[0], containerDir: found[1].directory }
    : { containerKey: null, containerDir: directory };
}

export type PendingUpload = {
  path: string;
  base64: string;
  previewUrl: string;
};

/**
 * The pieces the Assets page and the asset picker share: the folder
 * breadcrumbs, the drop zone, and the folder and file grids.
 */
import { ChevronRight, File as FileIcon, Folder, Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { AssetItem } from "../../core/service.js";
import { fileToBase64 } from "../api.js";
import { useVestry } from "../context.js";
import { cx, formatBytes } from "../lib/utils.js";
import { Button, Spinner } from "./ui.js";

/** Reads files for `api.uploadAssets`. */
export function uploadPayload(
  files: File[],
): Promise<{ name: string; base64: string }[]> {
  return Promise.all(
    files.map(async (f) => ({ name: f.name, base64: await fileToBase64(f) })),
  );
}

export function uploadedMessage(count: number): string {
  return `Uploaded ${count} file${count === 1 ? "" : "s"}`;
}

/** `root`, then a link for each folder of `path` under it. */
export function AssetCrumbs({
  root,
  path,
  onNavigate,
}: {
  root: string;
  path: string;
  onNavigate: (path: string) => void;
}) {
  const crumbs = path ? path.split("/") : [];
  return (
    <div className="v-breadcrumbs">
      <button type="button" onClick={() => onNavigate("")}>
        {root}
      </button>
      {crumbs.map((c, i) => (
        <span key={i} className="v-row" style={{ gap: 6 }}>
          <ChevronRight size={14} />
          <button
            type="button"
            onClick={() => onNavigate(crumbs.slice(0, i + 1).join("/"))}
          >
            {c}
          </button>
        </span>
      ))}
    </div>
  );
}

/** A hidden file input and the button that opens it. */
export function UploadButton({
  accept,
  multiple = true,
  busy,
  onFiles,
  variant,
  size,
}: {
  accept?: string[];
  multiple?: boolean;
  busy: boolean;
  onFiles: (files: File[]) => void;
  variant?: "primary";
  size?: "sm";
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple={multiple}
        accept={accept?.map((a) => `.${a}`).join(",")}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Cleared, so that choosing the same file again (to retry a
          // failed upload, say) is a change too.
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <Button
        variant={variant}
        size={size}
        onClick={() => fileInput.current?.click()}
        disabled={busy}
      >
        {busy ? <Spinner /> : <Upload />} Upload
      </Button>
    </>
  );
}

/** A box that takes dropped files, highlighted while files are over it. */
export function Dropzone({
  onFiles,
  children,
}: {
  onFiles: (files: File[]) => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
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
          onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {children}
    </div>
  );
}

export function FolderGrid({
  folders,
  onOpen,
}: {
  folders: string[];
  onOpen: (folder: string) => void;
}) {
  if (folders.length === 0) return null;
  return (
    <div className="v-asset-grid" style={{ marginBottom: 14 }}>
      {folders.map((f) => (
        <button
          key={f}
          type="button"
          className="v-folder"
          onClick={() => onOpen(f)}
        >
          <Folder /> {f}
        </button>
      ))}
    </div>
  );
}

/** The files, as tiles; clicking one selects it. */
export function AssetGrid({
  items,
  selected,
  onSelect,
  onOpen,
}: {
  items: AssetItem[];
  selected: string | null;
  onSelect: (path: string) => void;
  /** On double click. */
  onOpen?: (path: string) => void;
}) {
  const { api } = useVestry();
  return (
    <div className="v-asset-grid">
      {items.map((item) => (
        <button
          key={item.path}
          type="button"
          className={cx("v-asset", selected === item.path && "is-selected")}
          onClick={() => onSelect(item.path)}
          onDoubleClick={onOpen && (() => onOpen(item.path))}
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
          <div className="v-asset__meta">{formatBytes(item.size)}</div>
        </button>
      ))}
    </div>
  );
}

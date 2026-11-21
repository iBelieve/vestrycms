/**
 * The pieces the Assets page and the asset picker share: the folder
 * breadcrumbs, the drop zone, the folder and file grids, and the file list.
 */
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  File as FileIcon,
  Folder,
  Upload,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { AssetItem } from "../../core/service.js";
import { fileToBase64 } from "../api.js";
import {
  type AssetSort,
  type AssetSortField,
  relativeTo,
} from "../lib/asset-list.js";
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

/**
 * The folder a file sits in under `base`, when that isn't `base` itself;
 * nothing without a `base` (the picker) or for a file outside it.
 */
function subfolder(base: string, path: string): string {
  if (!base || !path.startsWith(`${base}/`)) return "";
  const rel = relativeTo(base, path);
  return rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
}

/** The files, as tiles; clicking one selects it. */
export function AssetGrid({
  items,
  base = "",
  selected,
  onSelect,
  onOpen,
}: {
  items: AssetItem[];
  /** The folder shown: a file from below it (a search) names its folder. */
  base?: string;
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
          <div className="v-asset__meta">
            {[subfolder(base, item.path), formatBytes(item.size)]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </button>
      ))}
    </div>
  );
}

function SortHeader({
  field,
  label,
  sort,
  onSort,
}: {
  field: AssetSortField;
  label: string;
  sort: AssetSort;
  onSort: (field: AssetSortField) => void;
}) {
  const active = sort.field === field;
  return (
    <th
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
      }
    >
      <button type="button" onClick={() => onSort(field)}>
        {label}
        {active && (sort.dir === "asc" ? <ArrowUp /> : <ArrowDown />)}
      </button>
    </th>
  );
}

/**
 * The folders and files as a table: each file's whole name, with its folder
 * under it when it sits below `base` (a search), its type and its size.
 * Clicking a name selects the file, or opens the folder.
 */
export function AssetTable({
  folders,
  items,
  base,
  sort,
  onSort,
  onSelect,
  onOpenFolder,
}: {
  folders: string[];
  items: AssetItem[];
  base: string;
  sort: AssetSort;
  onSort: (field: AssetSortField) => void;
  onSelect: (path: string) => void;
  onOpenFolder: (folder: string) => void;
}) {
  const header = (field: AssetSortField, label: string) => (
    <SortHeader field={field} label={label} sort={sort} onSort={onSort} />
  );
  return (
    <div className="v-table-wrap">
      <table className="v-table v-asset-table">
        <thead>
          <tr>
            {header("name", "Name")}
            {header("type", "Type")}
            {header("size", "Size")}
          </tr>
        </thead>
        <tbody>
          {folders.map((f) => (
            <tr key={`folder:${f}`}>
              <td className="v-table__main">
                <button
                  type="button"
                  className="v-asset-row"
                  onClick={() => onOpenFolder(f)}
                >
                  <span className="v-asset-row__thumb is-folder">
                    <Folder />
                  </span>
                  <span className="v-table__title">{f}</span>
                </button>
              </td>
              <td className="v-table__cell v-muted">Folder</td>
              <td className="v-table__cell" />
            </tr>
          ))}
          {items.map((item) => (
            <AssetTableRow
              key={item.path}
              item={item}
              folder={subfolder(base, item.path)}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssetTableRow({
  item,
  folder,
  onSelect,
}: {
  item: AssetItem;
  folder: string;
  onSelect: (path: string) => void;
}) {
  const { api } = useVestry();
  return (
    <tr>
      <td className="v-table__main">
        <button
          type="button"
          className="v-asset-row"
          onClick={() => onSelect(item.path)}
        >
          <span className="v-asset-row__thumb">
            {item.kind === "image" ? (
              <img
                src={api.fileUrl(item.path, item.sha)}
                alt=""
                loading="lazy"
              />
            ) : (
              <FileIcon />
            )}
          </span>
          <span className="v-table__label">
            <span className="v-table__title">{item.name}</span>
            {folder && <span className="v-table__sub v-mono">{folder}/</span>}
          </span>
        </button>
      </td>
      <td className="v-table__cell v-muted">
        {item.ext ? item.ext.toUpperCase() : "File"}
      </td>
      <td className="v-table__cell v-muted">{formatBytes(item.size)}</td>
    </tr>
  );
}

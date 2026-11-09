/**
 * The content source abstraction. Vestry reads and writes files through one
 * of these; the control panel never touches storage directly.
 *
 * Two implementations ship today:
 *  - `LocalSource` – the project directory on disk (used by `astro dev`).
 *  - `GitHubSource` – the GitHub REST (Git Data) API.
 *
 * Other git hosts (GitLab, Gitea, a bare git remote) would implement the same
 * interface.
 */

export interface TreeEntry {
  /** Repository-relative path, posix separators. */
  path: string;
  /** Git blob SHA (or a content hash for sources without git). */
  sha: string;
  size?: number;
}

export interface FileData {
  bytes: Uint8Array;
  sha: string;
}

export type FileChange =
  | {
      path: string;
      content: string | Uint8Array;
      encoding?: "utf-8" | "binary";
    }
  | { path: string; delete: true };

export interface CommitInfo {
  /** The resulting commit (or head) identifier. */
  sha: string;
  /** Link to the commit, if the source has one. */
  url?: string;
}

export interface CommitOptions {
  message: string;
  /** Who made the change; sources that commit as a service account credit them (e.g. as a co-author). */
  author?: { name: string; email: string };
  /** Required for optimistic concurrency: the head the client last saw. */
  expectedHead?: string;
}

export interface SourceInfo {
  kind: "local" | "github";
  /** Human description, e.g. `iBelieve/mluther.org@master` or the local directory. */
  label: string;
  branch?: string;
  /** Link to browse the source, if any. */
  url?: string;
}

export interface ContentSource {
  info(): SourceInfo;
  /** Current head commit SHA. Local sources return a synthetic value. */
  head(): Promise<string>;
  /** All files under `directory` (recursive). */
  list(directory: string): Promise<TreeEntry[]>;
  /** Read a file, or null if it doesn't exist. */
  read(path: string): Promise<FileData | null>;
  /** Apply a set of changes as one commit. */
  commit(changes: FileChange[], options: CommitOptions): Promise<CommitInfo>;
}

export class SourceError extends Error {
  constructor(
    message: string,
    public status = 500,
    public code = "source_error",
  ) {
    super(message);
    this.name = "SourceError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? encoder.encode(content) : content;
}

export function toText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Git blob SHA-1 of the given content: `sha1("blob <len>\0" + bytes)`. */
export async function gitBlobSha(
  content: string | Uint8Array,
): Promise<string> {
  const bytes = toBytes(content);
  const header = encoder.encode(`blob ${bytes.byteLength}\0`);
  const buf = new Uint8Array(header.byteLength + bytes.byteLength);
  buf.set(header, 0);
  buf.set(bytes, header.byteLength);
  const digest = await crypto.subtle.digest("SHA-1", buf as BufferSource);
  return hex(new Uint8Array(digest));
}

export function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function base64Encode(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined")
    return Buffer.from(bytes).toString("base64");
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64Decode(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  if (typeof Buffer !== "undefined")
    return new Uint8Array(Buffer.from(clean, "base64"));
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Wraps a source so every commit carries `author` unless the caller set one. */
export function withAuthor(
  source: ContentSource,
  author: { name: string; email: string },
): ContentSource {
  return {
    info: () => source.info(),
    head: () => source.head(),
    list: (directory) => source.list(directory),
    read: (path) => source.read(path),
    commit: (changes, options) =>
      source.commit(changes, { author, ...options }),
  };
}

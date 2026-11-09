import { promises as fs } from "node:fs";
import path from "node:path";
import {
  gitBlobSha,
  toBytes,
  SourceError,
  type CommitInfo,
  type CommitOptions,
  type ContentSource,
  type FileChange,
  type FileData,
  type SourceInfo,
  type TreeEntry,
} from "../source.js";
import { isSafeRepoPath, normalizePath } from "../paths.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".astro",
  ".wrangler",
]);

/**
 * Reads and writes the project directory directly. Used by `astro dev` so
 * editing feels instant and shows up in HMR; the developer commits with git
 * as usual.
 */
export class LocalSource implements ContentSource {
  constructor(private root: string) {}

  info(): SourceInfo {
    return { kind: "local", label: this.root };
  }

  async head(): Promise<string> {
    // Not a commit, but stable within a process so the UI can use it as a cache key.
    return "local";
  }

  #abs(p: string): string {
    const n = normalizePath(p);
    if (!isSafeRepoPath(n))
      throw new SourceError(`Invalid path "${p}"`, 400, "bad_path");
    const abs = path.resolve(this.root, n);
    if (
      !abs.startsWith(path.resolve(this.root) + path.sep) &&
      abs !== path.resolve(this.root)
    ) {
      throw new SourceError(
        `Path escapes project root: "${p}"`,
        400,
        "bad_path",
      );
    }
    return abs;
  }

  async list(directory: string): Promise<TreeEntry[]> {
    const base = this.#abs(directory);
    const out: TreeEntry[] = [];
    const walk = async (dir: string, rel: string) => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
        throw e;
      }
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), relPath);
        } else if (entry.isFile()) {
          const abs = path.join(dir, entry.name);
          const bytes = await fs.readFile(abs);
          out.push({
            path: normalizePath(`${directory}/${relPath}`),
            sha: await gitBlobSha(new Uint8Array(bytes)),
            size: bytes.byteLength,
          });
        }
      }
    };
    await walk(base, "");
    return out;
  }

  async read(p: string): Promise<FileData | null> {
    try {
      const buf = await fs.readFile(this.#abs(p));
      const bytes = new Uint8Array(buf);
      return { bytes, sha: await gitBlobSha(bytes) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async commit(
    changes: FileChange[],
    _options: CommitOptions,
  ): Promise<CommitInfo> {
    for (const change of changes) {
      const abs = this.#abs(change.path);
      if ("delete" in change) {
        await fs.rm(abs, { force: true });
        continue;
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, toBytes(change.content));
    }
    return { sha: "local" };
  }
}

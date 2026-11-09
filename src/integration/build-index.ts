import { promises as fs } from "node:fs";
import path from "node:path";
import type { VestryConfig } from "../config/types.js";
import { parseEntry } from "../core/entries.js";
import type { BuildIndex, IndexedFile } from "../core/index-types.js";
import {
  collectionFormat,
  normalizePath,
  parsePathPattern,
  slugFromPath,
} from "../core/paths.js";
import { gitBlobSha } from "../core/source.js";

/**
 * Scan every file-per-entry collection and record blob SHA + frontmatter.
 * Runs at build time inside the integration (Node), so it can read the
 * checked-out repository directly.
 */
export async function buildIndex(
  root: string,
  config: VestryConfig,
): Promise<BuildIndex> {
  const files: Record<string, IndexedFile> = {};
  for (const col of Object.values(config.collections ?? {})) {
    const pattern = parsePathPattern(col.path);
    if (pattern.single) continue;
    const format = collectionFormat(col);
    const dir = path.join(root, pattern.directory);
    for (const rel of await walk(dir)) {
      const repoPath = normalizePath(`${pattern.directory}/${rel}`);
      if (slugFromPath(pattern, repoPath) === null) continue;
      try {
        const buf = await fs.readFile(path.join(dir, rel));
        const text = buf.toString("utf8");
        const parsed = parseEntry(format, text);
        files[repoPath] = {
          sha: await gitBlobSha(new Uint8Array(buf)),
          data: JSON.parse(JSON.stringify(parsed.data)),
          excerpt: excerpt(parsed.body),
          hasBody: parsed.body.trim().length > 0,
        };
      } catch (e) {
        console.warn(
          `[vestry] Could not index ${repoPath}: ${(e as Error).message}`,
        );
      }
    }
  }
  return { builtAt: new Date().toISOString(), files };
}

async function walk(dir: string, rel = ""): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), r)));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

function excerpt(body: string): string | undefined {
  const text = body
    .replace(/^import .*$/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>`[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 200) : undefined;
}

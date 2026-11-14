/**
 * The build-time index. The integration scans every collection at build time
 * and records each entry file's git blob SHA alongside the part of its
 * frontmatter that listings show (`summaryData`).
 * At runtime the GitHub source compares the live tree against this index and
 * only fetches files that changed since the deploy, so listings are fast even
 * on a cold worker.
 */
export interface IndexedFile {
  sha: string;
  data: Record<string, unknown>;
  /** First ~200 characters of the body, for list previews. */
  excerpt?: string;
  /** Whether the body had any content. */
  hasBody?: boolean;
}

export interface BuildIndex {
  builtAt: string;
  files: Record<string, IndexedFile>;
}

export const EMPTY_INDEX: BuildIndex = { builtAt: "", files: {} };

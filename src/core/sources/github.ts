import {
  base64Decode,
  base64Encode,
  SourceError,
  toBytes,
  type CommitInfo,
  type CommitOptions,
  type ContentSource,
  type FileChange,
  type FileData,
  type SourceInfo,
  type TreeEntry,
} from "../source.js";
import { type Cache, sharedMemoryCache } from "../cache.js";
import { isSafeRepoPath, normalizePath } from "../paths.js";
import type { TokenProvider } from "./github-app.js";

export interface GitHubSourceOptions {
  owner: string;
  repo: string;
  /** Branch to read from and commit to. Resolved to the default branch when omitted. */
  branch?: string;
  /** A token with contents read/write access, or a provider that mints one (e.g. a GitHub App installation token). */
  token: string | TokenProvider | (() => Promise<string>);
  cache?: Cache;
  apiBase?: string;
  /** How long (seconds) to trust a cached branch head before re-checking. */
  headTtl?: number;
}

interface GitTree {
  sha: string;
  truncated: boolean;
  tree: {
    path: string;
    type: "blob" | "tree" | "commit";
    sha: string;
    size?: number;
  }[];
}

interface CachedHead {
  sha: string;
  treeSha: string;
  etag?: string;
}

/**
 * GitHub-backed source using the Git Data API.
 *
 * Reads: the branch head is cached briefly (and revalidated with ETags, which
 * don't count against the rate limit); the recursive tree is cached per tree
 * SHA; blobs are cached per blob SHA (immutable). After one of our own commits
 * the head cache is updated in place so the next read sees the new state
 * without waiting for the TTL.
 *
 * Writes: blobs → tree (on top of the base tree) → commit → ref update, which
 * yields a single commit per save even when assets are uploaded alongside.
 */
export class GitHubSource implements ContentSource {
  #branch?: string;
  #cache: Cache;
  #headTtl: number;
  #apiBase: string;

  constructor(private opts: GitHubSourceOptions) {
    this.#branch = opts.branch;
    this.#cache = opts.cache ?? sharedMemoryCache();
    this.#headTtl = opts.headTtl ?? 20;
    this.#apiBase = (opts.apiBase ?? "https://api.github.com").replace(
      /\/$/,
      "",
    );
  }

  info(): SourceInfo {
    return {
      kind: "github",
      label: `${this.opts.owner}/${this.opts.repo}${this.#branch ? `@${this.#branch}` : ""}`,
      branch: this.#branch,
      url: `https://github.com/${this.opts.owner}/${this.opts.repo}`,
    };
  }

  get repoPath(): string {
    return `${this.opts.owner}/${this.opts.repo}`;
  }

  async #token(): Promise<string> {
    return typeof this.opts.token === "function"
      ? this.opts.token()
      : this.opts.token;
  }

  async #request<T>(
    path: string,
    init: RequestInit & { etag?: string; raw?: boolean } = {},
  ): Promise<{ status: number; data: T; etag?: string }> {
    const headers = requestHeaders(init, await this.#token());
    const url = `${this.#apiBase}${path}`;
    let res = await fetch(url, { ...init, headers });
    const { token } = this.opts;
    if (
      res.status === 401 &&
      typeof token === "function" &&
      "invalidate" in token
    ) {
      // A cached installation token GitHub no longer accepts (app reinstalled,
      // key rotated): mint a fresh one and retry once. The refusal's body is
      // released first, so the Worker does not hold its connection open.
      await res.body?.cancel();
      token.invalidate();
      headers.set("Authorization", `Bearer ${await this.#token()}`);
      res = await fetch(url, { ...init, headers });
    }
    return readResponse<T>(res, path, init);
  }

  async branch(): Promise<string> {
    if (this.#branch) return this.#branch;
    const key = `gh:${this.repoPath}:default-branch`;
    const cached = await this.#cache.get<string>(key);
    if (cached) return (this.#branch = cached);
    const { data } = await this.#request<{ default_branch: string }>(
      `/repos/${this.repoPath}`,
    );
    this.#branch = data.default_branch;
    await this.#cache.set(key, this.#branch, 3600);
    return this.#branch;
  }

  #headKey(branch: string) {
    return `gh:${this.repoPath}:head:${branch}`;
  }

  async #resolveHead(): Promise<CachedHead> {
    const branch = await this.branch();
    const key = this.#headKey(branch);
    const fresh = await this.#cache.get<CachedHead & { checked: number }>(key);
    if (fresh && Date.now() - fresh.checked < this.#headTtl * 1000)
      return fresh;

    const { status, data, etag } = await this.#request<{
      object: { sha: string };
    }>(`/repos/${this.repoPath}/git/ref/heads/${encodeURIComponent(branch)}`, {
      etag: fresh?.etag,
    });
    if (status === 304 && fresh) {
      const bumped = { ...fresh, checked: Date.now() };
      await this.#cache.set(key, bumped, 3600);
      return bumped;
    }
    const sha = data.object.sha;
    const treeSha = await this.#treeShaForCommit(sha);
    const head = { sha, treeSha, etag, checked: Date.now() };
    await this.#cache.set(key, head, 3600);
    return head;
  }

  async #treeShaForCommit(commitSha: string): Promise<string> {
    const key = `gh:${this.repoPath}:commit:${commitSha}`;
    const cached = await this.#cache.get<string>(key);
    if (cached) return cached;
    const { data } = await this.#request<{ tree: { sha: string } }>(
      `/repos/${this.repoPath}/git/commits/${commitSha}`,
    );
    await this.#cache.set(key, data.tree.sha);
    return data.tree.sha;
  }

  async head(): Promise<string> {
    return (await this.#resolveHead()).sha;
  }

  async #tree(treeSha: string): Promise<TreeEntry[]> {
    const key = `gh:${this.repoPath}:tree:${treeSha}`;
    const cached = await this.#cache.get<TreeEntry[]>(key);
    if (cached) return cached;
    const { data } = await this.#request<GitTree>(
      `/repos/${this.repoPath}/git/trees/${treeSha}?recursive=1`,
    );
    if (data.truncated) {
      throw new SourceError(
        "Repository tree is too large for the GitHub API to return in one request",
        500,
        "tree_truncated",
      );
    }
    const entries = data.tree
      .filter((e) => e.type === "blob")
      .map((e) => ({ path: e.path, sha: e.sha, size: e.size }));
    await this.#cache.set(key, entries);
    return entries;
  }

  async list(directory: string): Promise<TreeEntry[]> {
    const head = await this.#resolveHead();
    const dir = normalizePath(directory);
    const all = await this.#tree(head.treeSha);
    if (!dir) return all;
    const prefix = `${dir}/`;
    return all.filter((e) => e.path.startsWith(prefix));
  }

  async #findBlob(p: string): Promise<TreeEntry | undefined> {
    const head = await this.#resolveHead();
    const all = await this.#tree(head.treeSha);
    const n = normalizePath(p);
    return all.find((e) => e.path === n);
  }

  async readBlob(sha: string): Promise<Uint8Array> {
    const key = `gh:${this.repoPath}:blob:${sha}`;
    const cached = await this.#cache.get<string>(key);
    if (cached !== undefined) return base64Decode(cached);
    const { data } = await this.#request<Uint8Array>(
      `/repos/${this.repoPath}/git/blobs/${sha}`,
      { raw: true },
    );
    // Cache up to ~2 MB blobs; bigger files are re-fetched on demand.
    if (data.byteLength <= 2 * 1024 * 1024) {
      await this.#cache.set(key, base64Encode(data));
    }
    return data;
  }

  async read(p: string): Promise<FileData | null> {
    if (!isSafeRepoPath(p))
      throw new SourceError(`Invalid path "${p}"`, 400, "bad_path");
    const entry = await this.#findBlob(p);
    if (!entry) return null;
    return { bytes: await this.readBlob(entry.sha), sha: entry.sha };
  }

  async commit(
    changes: FileChange[],
    options: CommitOptions,
  ): Promise<CommitInfo> {
    const branch = await this.branch();
    const head = await this.#resolveHead();
    if (options.expectedHead && options.expectedHead !== head.sha) {
      // Someone else pushed; the caller decides whether that's a conflict for
      // the specific files it touched. We still build on the latest head.
    }

    const tree: {
      path: string;
      mode: "100644";
      type: "blob";
      sha: string | null;
    }[] = [];
    for (const change of changes) {
      if (!isSafeRepoPath(change.path)) {
        throw new SourceError(`Invalid path "${change.path}"`, 400, "bad_path");
      }
      if ("delete" in change) {
        tree.push({
          path: normalizePath(change.path),
          mode: "100644",
          type: "blob",
          sha: null,
        });
        continue;
      }
      const bytes = toBytes(change.content);
      const { data: blob } = await this.#request<{ sha: string }>(
        `/repos/${this.repoPath}/git/blobs`,
        {
          method: "POST",
          body: JSON.stringify({
            content: base64Encode(bytes),
            encoding: "base64",
          }),
        },
      );
      await this.#cache.set(
        `gh:${this.repoPath}:blob:${blob.sha}`,
        base64Encode(bytes),
      );
      tree.push({
        path: normalizePath(change.path),
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    const { data: newTree } = await this.#request<{ sha: string }>(
      `/repos/${this.repoPath}/git/trees`,
      {
        method: "POST",
        body: JSON.stringify({ base_tree: head.treeSha, tree }),
      },
    );
    const { data: commit } = await this.#request<{
      sha: string;
      html_url: string;
    }>(`/repos/${this.repoPath}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        // Author and committer default to the token's identity (the GitHub
        // App's bot). Setting `author` would make GitHub copy it into the
        // committer too, so the editor is credited as a co-author instead.
        message: withCoAuthor(options.message, options.author),
        tree: newTree.sha,
        parents: [head.sha],
      }),
    });
    try {
      await this.#request(
        `/repos/${this.repoPath}/git/refs/heads/${encodeURIComponent(branch)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: commit.sha, force: false }),
        },
      );
    } catch (e) {
      if (e instanceof SourceError && (e.status === 422 || e.status === 409)) {
        // Not a fast-forward: the branch moved while we were committing.
        await this.#cache.delete(this.#headKey(branch));
        throw new SourceError(
          "The branch changed while saving. Reload and try again.",
          409,
          "conflict",
        );
      }
      throw e;
    }

    const newHead: CachedHead & { checked: number } = {
      sha: commit.sha,
      treeSha: newTree.sha,
      etag: undefined,
      checked: Date.now(),
    };
    await this.#cache.set(this.#headKey(branch), newHead, 3600);
    await this.#cache.set(
      `gh:${this.repoPath}:commit:${commit.sha}`,
      newTree.sha,
    );
    return { sha: commit.sha, url: commit.html_url };
  }
}

/** Appends a `Co-authored-by` trailer, which GitHub shows as a second author. */
function withCoAuthor(
  message: string,
  author?: { name: string; email: string },
): string {
  if (!author?.email) return message;
  const trailer = `Co-authored-by: ${author.name || author.email} <${author.email}>`;
  return `${message.trimEnd()}\n\n${trailer}`;
}

/** The headers of a request to GitHub's REST API. */
function requestHeaders(
  init: RequestInit & { etag?: string; raw?: boolean },
  token: string,
): Headers {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set(
    "Accept",
    init.raw
      ? "application/vnd.github.raw+json"
      : "application/vnd.github+json",
  );
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", "vestry");
  if (typeof init.body === "string")
    headers.set("Content-Type", "application/json");
  if (init.etag) headers.set("If-None-Match", init.etag);
  return headers;
}

/** A response's data (JSON, or bytes for `raw`), or the error it reports. */
async function readResponse<T>(
  res: Response,
  path: string,
  init: { etag?: string; raw?: boolean },
): Promise<{ status: number; data: T; etag?: string }> {
  if (res.status === 304) {
    return { status: 304, data: undefined as T, etag: init.etag };
  }
  if (!res.ok) throw await responseError(res, path);
  const data = (
    init.raw ? new Uint8Array(await res.arrayBuffer()) : await res.json()
  ) as T;
  return {
    status: res.status,
    data,
    etag: res.headers.get("etag") ?? undefined,
  };
}

const ERROR_CODES: Record<number, string> = {
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
};

/** A failed response as a SourceError, with GitHub's message if it gave one. */
async function responseError(
  res: Response,
  path: string,
): Promise<SourceError> {
  let message = `GitHub API ${res.status} for ${path}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) message = `${body.message} (${res.status} ${path})`;
  } catch {
    /* ignore */
  }
  return new SourceError(
    message,
    res.status,
    ERROR_CODES[res.status] ?? "github_error",
  );
}

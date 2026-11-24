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
  type SourceCheckRun,
  type SourceCommit,
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
  /** The commit's tree, once known (our own commits, or a save's lookup). */
  treeSha?: string;
  etag?: string;
}

/**
 * GitHub-backed source using the Git Data API.
 *
 * Reads: the branch head is cached briefly (and revalidated with ETags, which
 * don't count against the rate limit); the recursive tree is read by the
 * head commit's SHA (GitHub resolves it to the commit's tree, which saves
 * reading the commit first) and cached per commit; blobs are cached per blob
 * SHA (immutable). After one of our own commits
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
  #inflight = new Map<string, { promise: Promise<unknown>; started: number }>();
  /**
   * Branch moves we know of (our commits, and the pushes our conflicts
   * reveal), so a head load that one overtook does not undo it.
   */
  #commits = 0;

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
    const url = /^https?:/.test(path) ? path : `${this.#apiBase}${path}`;
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

  /**
   * Concurrent callers of `load` under one key share its promise, so the
   * dashboard's parallel listings (or several editors at once) cost one
   * GitHub round trip and one parse rather than one each.
   *
   * A load is joined only while it is young. On a Worker the load belongs to
   * the request that started it, and when that request's client goes away
   * its pending fetches are cancelled and their promises never settle; an
   * entry older than `SHARED_LOAD_MS` is taken for such a load and replaced,
   * so it cannot hold up every later request in the isolate. A caller that
   * joined it waits only until the window ends, then loads again itself.
   */
  #shared<T>(key: string, load: () => Promise<T>): Promise<T> {
    const pending = this.#inflight.get(key);
    const age = pending ? Date.now() - pending.started : SHARED_LOAD_MS;
    if (!pending || age >= SHARED_LOAD_MS) return this.#startShared(key, load);
    return settleWithin(
      pending.promise as Promise<T>,
      SHARED_LOAD_MS - age,
      () =>
        this.#inflight.get(key) === pending
          ? this.#startShared(key, load)
          : this.#shared(key, load),
    );
  }

  #startShared<T>(key: string, load: () => Promise<T>): Promise<T> {
    const promise = load().finally(() => {
      if (this.#inflight.get(key)?.promise === promise)
        this.#inflight.delete(key);
    });
    this.#inflight.set(key, { promise, started: Date.now() });
    return promise;
  }

  #resolveHead(): Promise<CachedHead> {
    return this.#shared("head", () => this.#loadHead());
  }

  async #loadHead(): Promise<CachedHead> {
    const commits = this.#commits;
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
    if (status === 304 && fresh)
      return this.#storeHead(key, { ...fresh, checked: Date.now() }, commits);
    return this.#storeHead(
      key,
      { sha: data.object.sha, etag, checked: Date.now() },
      commits,
    );
  }

  /**
   * Caches the head a load read, unless the branch moved while it was
   * reading: GitHub may have answered before the move, so the head our
   * commit cached is the newer one, and after a conflict (which leaves no
   * head cached) what the load read is not cached at all.
   */
  async #storeHead(
    key: string,
    head: CachedHead & { checked: number },
    commits: number,
  ): Promise<CachedHead> {
    if (commits !== this.#commits)
      return (await this.#cache.get<CachedHead>(key)) ?? head;
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

  prefetch(what: "head" | "token"): Promise<void> {
    const load: Promise<unknown> =
      what === "head" ? this.#resolveHead() : this.#token();
    // The read that needs it reports any failure.
    return load.then(
      () => {},
      () => {},
    );
  }

  #tree(commitSha: string): Promise<TreeEntry[]> {
    return this.#shared(`tree:${commitSha}`, () => this.#loadTree(commitSha));
  }

  /** The files at a commit, read in one request by the commit's SHA. */
  async #loadTree(commitSha: string): Promise<TreeEntry[]> {
    const key = `gh:${this.repoPath}:commit-tree:${commitSha}`;
    const cached = await this.#cache.get<TreeEntry[]>(key);
    if (cached) return cached;
    const { data } = await this.#request<GitTree>(
      `/repos/${this.repoPath}/git/trees/${commitSha}?recursive=1`,
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
    const all = await this.#tree(head.sha);
    if (!dir) return all;
    const prefix = `${dir}/`;
    return all.filter((e) => e.path.startsWith(prefix));
  }

  async #findBlob(p: string): Promise<TreeEntry | undefined> {
    const head = await this.#resolveHead();
    const all = await this.#tree(head.sha);
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
        body: JSON.stringify({
          base_tree: head.treeSha ?? (await this.#treeShaForCommit(head.sha)),
          tree,
        }),
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
        // Not a fast-forward: the branch moved while we were committing. A
        // head load still in flight may have read it before it moved, so it
        // must neither be joined nor cache what it read.
        this.#commits++;
        this.#inflight.delete("head");
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
    // A head load still in flight may have read the branch before this
    // commit: later callers must not join it, nor may it overwrite this.
    this.#commits++;
    this.#inflight.delete("head");
    await this.#cache.set(this.#headKey(branch), newHead, 3600);
    await this.#cache.delete(this.#commitsKey(branch));
    await this.#cache.set(
      `gh:${this.repoPath}:commit:${commit.sha}`,
      newTree.sha,
    );
    return { sha: commit.sha, url: commit.html_url };
  }

  #commitsKey(branch: string) {
    return `gh:${this.repoPath}:recent:${branch}`;
  }

  /**
   * The branch's latest commits with their check runs, in one GraphQL
   * request. Cached for a few seconds, so several editors polling share it;
   * a commit of ours clears it. Reading check runs needs the app's Checks
   * permission: without it this throws a 403 `checks_forbidden`.
   */
  async recentCommits(limit: number): Promise<SourceCommit[]> {
    const branch = await this.branch();
    const key = this.#commitsKey(branch);
    const cached = await this.#cache.get<{
      limit: number;
      commits: SourceCommit[];
      checked: number;
    }>(key);
    // Freshness is checked here rather than left to the cache's TTL, which a
    // KV cache stretches to at least a minute.
    if (
      cached &&
      cached.limit >= limit &&
      Date.now() - cached.checked < RECENT_COMMITS_TTL * 1000
    )
      return cached.commits.slice(0, limit);
    const { data } = await this.#request<GraphQLResponse<RecentCommitsData>>(
      graphqlUrl(this.#apiBase),
      {
        method: "POST",
        body: JSON.stringify({
          query: RECENT_COMMITS_QUERY,
          variables: {
            owner: this.opts.owner,
            name: this.opts.repo,
            ref: `refs/heads/${branch}`,
            limit,
          },
        }),
      },
    );
    const commits = readRecentCommits(data);
    await this.#cache.set(
      key,
      { limit, commits, checked: Date.now() },
      RECENT_COMMITS_TTL,
    );
    return commits;
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

/** How long (ms) a pending head or tree load is joined by other callers. */
const SHARED_LOAD_MS = 10_000;

/**
 * `promise`'s outcome, unless it has not settled within `ms`: then
 * `fallback()`'s. On a Worker a shared load can be cancelled with the
 * request that started it and never settle, and a caller that joined it
 * would otherwise wait until the runtime gave up on its own request.
 */
function settleWithin<T>(
  promise: Promise<T>,
  ms: number,
  fallback: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      fallback().then(resolve, reject);
    }, ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// ------------------------------------------------------------ check runs

/** How long (seconds) recent commits and their check runs are reused. */
const RECENT_COMMITS_TTL = 5;

const RECENT_COMMITS_QUERY = `query($owner: String!, $name: String!, $ref: String!, $limit: Int!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) {
      target {
        ... on Commit {
          history(first: $limit) {
            nodes {
              oid
              messageHeadline
              message
              committedDate
              url
              author { name email }
              checkSuites(first: 10) {
                nodes {
                  checkRuns(first: 10) {
                    nodes { name status conclusion startedAt completedAt detailsUrl }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: { type?: string; message: string; path?: (string | number)[] }[];
}

interface RecentCommitsData {
  repository: {
    ref: {
      target: {
        history?: {
          nodes: {
            oid: string;
            messageHeadline: string;
            message: string;
            committedDate: string;
            url: string | null;
            author: { name: string | null; email: string | null } | null;
            checkSuites: {
              nodes: {
                checkRuns: {
                  nodes: {
                    name: string;
                    status: string;
                    conclusion: string | null;
                    startedAt: string | null;
                    completedAt: string | null;
                    detailsUrl: string | null;
                  }[];
                } | null;
              }[];
            } | null;
          }[];
        };
      } | null;
    } | null;
  } | null;
}

/** GitHub's GraphQL endpoint for a REST API base (GitHub Enterprise serves it at `/api/graphql`). */
function graphqlUrl(apiBase: string): string {
  return apiBase.endsWith("/api/v3")
    ? `${apiBase.slice(0, -"/v3".length)}/graphql`
    : `${apiBase}/graphql`;
}

/** The commits in a recent-commits response, or the error it reports. */
function readRecentCommits(
  response: GraphQLResponse<RecentCommitsData>,
): SourceCommit[] {
  const errors = response.errors ?? [];
  if (errors.some((e) => e.type === "FORBIDDEN")) {
    throw new SourceError(
      "The GitHub App cannot read check runs. Give it the Checks: Read-only permission.",
      403,
      "checks_forbidden",
    );
  }
  const history = response.data?.repository?.ref?.target?.history;
  if (!history) {
    if (errors.length) {
      throw new SourceError(
        `GitHub GraphQL: ${errors[0].message}`,
        502,
        "github_error",
      );
    }
    return [];
  }
  return history.nodes.map((node) => ({
    sha: node.oid,
    title: node.messageHeadline,
    message: node.message,
    date: node.committedDate,
    url: node.url,
    author: {
      name: node.author?.name ?? "Unknown",
      email: node.author?.email ?? null,
    },
    checks: (node.checkSuites?.nodes ?? []).flatMap((suite) =>
      (suite.checkRuns?.nodes ?? []).map((run): SourceCheckRun => ({
        name: run.name,
        status: checkStatus(run.status),
        conclusion: run.conclusion?.toLowerCase() ?? null,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        url: run.detailsUrl,
      })),
    ),
  }));
}

/** GraphQL's check status as the REST names: anything not yet running is queued. */
function checkStatus(status: string): SourceCheckRun["status"] {
  if (status === "COMPLETED") return "completed";
  if (status === "IN_PROGRESS") return "in_progress";
  return "queued";
}

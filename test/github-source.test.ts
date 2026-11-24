/**
 * Runs GitHubSource.commit against an in-process fake of the Git Data API,
 * checking the blob → tree → commit → ref sequence and payloads. The commit
 * tests share the fake repository and build on each other, so run the file
 * whole rather than filtering to one of them.
 */
import { createServer } from "node:http";
import { afterAll, describe, expect, it, vi } from "vitest";
import { collection, defineConfig, fields } from "../src/config/index.js";
import { ContentService } from "../src/core/service.js";
import { GitHubSource } from "../src/core/sources/github.js";
import { MemoryCache } from "../src/core/cache.js";
import { base64Decode, toText } from "../src/core/source.js";

const blobs = new Map<string, Uint8Array>();
const trees = new Map<
  string,
  { path: string; sha: string | null; type: string; mode: string }[]
>();
const commits = new Map<
  string,
  { tree: string; parents: string[]; message: string; author?: unknown }
>();
let n = 0;
const sha = (p: string) =>
  `${p}${(++n).toString(16).padStart(40 - p.length, "0")}`;

const baseTree = sha("aa");
trees.set(baseTree, [
  { path: "README.md", sha: sha("b1"), type: "blob", mode: "100644" },
  {
    path: "src/content/sermons/old.mdx",
    sha: sha("b2"),
    type: "blob",
    mode: "100644",
  },
]);
blobs.set(
  trees.get(baseTree)![1].sha!,
  new TextEncoder().encode("---\ntitle: Old\n---\n"),
);
const baseCommit = sha("cc");
commits.set(baseCommit, { tree: baseTree, parents: [], message: "init" });
let head = baseCommit;
const log: string[] = [];

// oxlint-disable-next-line typescript/no-misused-promises -- a failure here fails the test.
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://x");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString())
    : null;
  log.push(`${req.method} ${url.pathname}`);
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (req.headers.authorization !== "Bearer tok")
    return json(401, { message: "bad token" });
  const p = url.pathname.replace("/repos/o/r", "");
  if (req.method === "GET" && p === "/git/ref/heads/main")
    return json(200, { object: { sha: head } });
  if (req.method === "GET" && p.startsWith("/git/commits/"))
    return json(200, { tree: { sha: commits.get(p.slice(13))!.tree } });
  if (req.method === "GET" && p.startsWith("/git/trees/")) {
    // Like GitHub, a commit's SHA reads that commit's tree (and the answer
    // carries the SHA asked for, not the tree's).
    const id = p.slice(11);
    return json(200, {
      sha: id,
      truncated: false,
      tree: trees.get(id) ?? trees.get(commits.get(id)?.tree ?? ""),
    });
  }
  if (req.method === "GET" && p.startsWith("/git/blobs/")) {
    const b = blobs.get(p.slice(11));
    res.writeHead(200, { "content-type": "application/vnd.github.raw" });
    return res.end(Buffer.from(b!));
  }
  if (req.method === "POST" && p === "/git/blobs") {
    if (body.encoding !== "base64") return json(422, { message: "encoding" });
    const s = sha("b");
    blobs.set(s, base64Decode(body.content));
    return json(201, { sha: s });
  }
  if (req.method === "POST" && p === "/git/trees") {
    const base = trees.get(body.base_tree)!;
    const next = base.filter(
      (e) => !body.tree.some((t: { path: string }) => t.path === e.path),
    );
    for (const t of body.tree) if (t.sha !== null) next.push(t);
    const s = sha("t");
    trees.set(s, next);
    return json(201, { sha: s });
  }
  if (req.method === "POST" && p === "/git/commits") {
    const s = sha("c");
    commits.set(s, body);
    return json(201, { sha: s, html_url: `http://x/commit/${s}` });
  }
  if (req.method === "PATCH" && p === "/git/refs/heads/main") {
    if (commits.get(body.sha)!.parents[0] !== head)
      return json(422, { message: "not fast forward" });
    head = body.sha;
    return json(200, { object: { sha: head } });
  }
  json(404, { message: `unhandled ${req.method} ${p}` });
});
await new Promise<void>((r) => server.listen(0, r));
afterAll(() => void server.close());
const port = (server.address() as { port: number }).port;

const src = new GitHubSource({
  owner: "o",
  repo: "r",
  branch: "main",
  token: "tok",
  apiBase: `http://127.0.0.1:${port}`,
});

const png = new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]);
const text = async (path: string) => toText((await src.read(path))!.bytes);

describe("GitHubSource reads", () => {
  it("resolves the branch head", async () => {
    expect(await src.head()).toBe(baseCommit);
  });

  it("lists files under a directory", async () => {
    expect(await src.list("src/content/sermons")).toHaveLength(1);
  });

  it("reads a blob", async () => {
    expect(await text("src/content/sermons/old.mdx")).toContain("Old");
  });

  it("shares one head and tree fetch between concurrent reads", async () => {
    const cold = new GitHubSource({
      owner: "o",
      repo: "r",
      branch: "main",
      token: "tok",
      apiBase: `http://127.0.0.1:${port}`,
      cache: new MemoryCache(),
    });
    log.length = 0;
    const lists = await Promise.all([
      cold.list("src/content/sermons"),
      cold.list(""),
      cold.read("src/content/sermons/old.mdx"),
    ]);
    expect(lists[0]).toHaveLength(1);
    expect(log.filter((l) => l.includes("/git/ref/"))).toHaveLength(1);
    // The tree is read by the commit's SHA, without reading the commit.
    expect(log.filter((l) => l.includes("/git/commits/"))).toHaveLength(0);
    expect(log.filter((l) => l.includes("/git/trees/"))).toHaveLength(1);
  });

  it("starts the head on prefetch, and the next read joins it", async () => {
    const cold = new GitHubSource({
      owner: "o",
      repo: "r",
      branch: "main",
      token: "tok",
      apiBase: `http://127.0.0.1:${port}`,
      cache: new MemoryCache(),
    });
    log.length = 0;
    cold.prefetch("head");
    expect(await cold.list("src/content/sermons")).toHaveLength(1);
    expect(log.filter((l) => l.includes("/git/ref/"))).toHaveLength(1);
  });
});

describe("GitHubSource shared loads", () => {
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  }

  /** A fake GitHub on `fetch`, whose `n`th ref read waits for `refGate`. */
  function fakeGitHub(options: {
    refGate?: { n: number; promise: Promise<void> };
    blobGate?: Promise<void>;
    /** Refuse the ref update, as GitHub does when someone else pushed. */
    conflict?: boolean;
  }) {
    const seen: string[] = [];
    let branchHead = "c0";
    let refs = 0;
    const tree: Record<string, string> = { c0: "t0", c1: "t1" };
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const method = init?.method ?? "GET";
        const p = new URL(String(input)).pathname.replace("/repos/o/r", "");
        seen.push(`${method} ${p}`);
        if (p === "/git/ref/heads/main") {
          // GitHub answers with the head as it is when asked.
          const sha = branchHead;
          if (++refs === options.refGate?.n) await options.refGate.promise;
          return Response.json({ object: { sha } });
        }
        if (method === "GET" && p.startsWith("/git/commits/"))
          return Response.json({ tree: { sha: tree[p.slice(13)] } });
        if (p === "/git/blobs") {
          await options.blobGate;
          return Response.json({ sha: "b1" }, { status: 201 });
        }
        if (p === "/git/trees")
          return Response.json({ sha: "t1" }, { status: 201 });
        if (p === "/git/commits")
          return Response.json(
            { sha: "c1", html_url: "http://x/c1" },
            { status: 201 },
          );
        if (p === "/git/refs/heads/main") {
          if (options.conflict)
            return Response.json(
              { message: "Update is not a fast forward" },
              { status: 422 },
            );
          branchHead = "c1";
          return Response.json({ object: { sha: "c1" } });
        }
        return Response.json({ message: "unhandled" }, { status: 404 });
      });
    return { seen, restore: () => spy.mockRestore() };
  }

  const source = (headTtl?: number) =>
    new GitHubSource({
      owner: "o",
      repo: "r",
      branch: "main",
      token: "tok",
      apiBase: "http://gh.test",
      cache: new MemoryCache(),
      headTtl,
    });

  it("stops joining a load that never settles", async () => {
    // A load whose request was cancelled on a Worker never settles.
    const gh = fakeGitHub({
      refGate: { n: 1, promise: new Promise(() => {}) },
    });
    let now = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const src = source();
      void src.head();
      now += 60_000;
      expect(await src.head()).toBe("c0");
    } finally {
      clock.mockRestore();
      gh.restore();
    }
  });

  it("does not leave a caller that joined such a load waiting", async () => {
    const gh = fakeGitHub({
      refGate: { n: 1, promise: new Promise(() => {}) },
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const src = source();
      void src.head();
      await vi.advanceTimersByTimeAsync(1_000);
      const joined = src.head();
      await vi.advanceTimersByTimeAsync(9_000);
      expect(await joined).toBe("c0");
      expect(gh.seen.filter((s) => s.includes("/git/ref/"))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
      gh.restore();
    }
  });

  it("keeps a head read before our commit from hiding it", async () => {
    const refGate = deferred();
    const blobGate = deferred();
    const gh = fakeGitHub({
      refGate: { n: 2, promise: refGate.promise },
      blobGate: blobGate.promise,
    });
    try {
      // headTtl 0: every read asks GitHub, as one 20 s after the last does.
      const src = source(0);
      const committing = src.commit([{ path: "a.md", content: "a" }], {
        message: "m",
      });
      await vi.waitFor(() => expect(gh.seen).toContain("POST /git/blobs"));
      // Another request reads the head before the commit moves the branch.
      const reading = src.head();
      await vi.waitFor(() =>
        expect(gh.seen.filter((s) => s.includes("/git/ref/"))).toHaveLength(2),
      );
      blobGate.resolve();
      expect((await committing).sha).toBe("c1");
      const after = src.head();
      refGate.resolve();
      expect(await reading).toBe("c1");
      expect(await after).toBe("c1");
    } finally {
      gh.restore();
    }
  });

  it("does not cache a head read across a conflict", async () => {
    const refGate = deferred();
    const blobGate = deferred();
    const gh = fakeGitHub({
      refGate: { n: 2, promise: refGate.promise },
      blobGate: blobGate.promise,
      conflict: true,
    });
    const cache = new MemoryCache();
    try {
      const src = new GitHubSource({
        owner: "o",
        repo: "r",
        branch: "main",
        token: "tok",
        apiBase: "http://gh.test",
        cache,
        headTtl: 0,
      });
      const committing = src.commit([{ path: "a.md", content: "a" }], {
        message: "m",
      });
      await vi.waitFor(() => expect(gh.seen).toContain("POST /git/blobs"));
      // Read before the push that the conflict reveals: a stale head.
      const reading = src.head();
      await vi.waitFor(() =>
        expect(gh.seen.filter((s) => s.includes("/git/ref/"))).toHaveLength(2),
      );
      blobGate.resolve();
      await expect(committing).rejects.toMatchObject({ code: "conflict" });
      refGate.resolve();
      expect(await reading).toBe("c0");
      expect(await cache.get("gh:o/r:head:main")).toBeUndefined();
    } finally {
      gh.restore();
    }
  });
});

// The commits below build on each other, so these tests run in order.
describe("GitHubSource.commit", () => {
  let c1: { sha: string };

  it("writes blobs, a tree and a commit, then moves the ref", async () => {
    log.length = 0;
    c1 = await src.commit(
      [
        {
          path: "src/content/sermons/new.mdx",
          content: "---\ntitle: New\n---\n",
        },
        { path: "src/assets/x.png", content: png },
        { path: "README.md", delete: true },
      ],
      { message: "Create Sermon: New" },
    );
    expect(head).toBe(c1.sha);
    expect(log.filter((l) => !l.startsWith("GET"))).toEqual([
      "POST /repos/o/r/git/blobs",
      "POST /repos/o/r/git/blobs",
      "POST /repos/o/r/git/trees",
      "POST /repos/o/r/git/commits",
      "PATCH /repos/o/r/git/refs/heads/main",
    ]);
    const commit = commits.get(c1.sha)!;
    expect(commit.parents).toEqual([baseCommit]);
    expect(commit.message).toBe("Create Sermon: New");
  });

  it("leaves the author to the token's identity", () => {
    expect(commits.get(c1.sha)!.author).toBeUndefined();
  });

  it("applies deletes and binary additions to the tree", () => {
    const paths = trees.get(commits.get(c1.sha)!.tree)!.map((e) => e.path);
    expect(paths).not.toContain("README.md");
    expect(paths).toContain("src/assets/x.png");
  });

  it("advances the cached head without refetching", async () => {
    log.length = 0;
    expect(await src.head()).toBe(c1.sha);
    expect(log).not.toContain("GET /repos/o/r/git/ref/heads/main");
  });

  it("round-trips binary content", async () => {
    const back = await src.read("src/assets/x.png");
    expect([...back!.bytes]).toEqual([...png]);
  });

  it("chains a second commit on the first", async () => {
    const c2 = await src.commit(
      [
        {
          path: "src/content/sermons/new.mdx",
          content: "---\ntitle: Newer\n---\n",
        },
      ],
      { message: "Update" },
    );
    expect(commits.get(c2.sha)!.parents).toEqual([c1.sha]);
    expect(await text("src/content/sermons/new.mdx")).toContain("Newer");
  });

  it("reports a non-fast-forward ref update as a conflict", async () => {
    // Someone else pushed: the cached head is now stale.
    head = baseCommit;
    await expect(
      src.commit([{ path: "a.txt", content: "x" }], { message: "stale" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("records the editor as a Co-authored-by trailer", async () => {
    const c3 = await src.commit(
      [
        {
          path: "src/content/sermons/coauthor.mdx",
          content: "---\ntitle: C\n---\n",
        },
      ],
      {
        message: "Update Sermon: C",
        author: { name: "Pastor Example", email: "pastor@example.org" },
      },
    );
    const commit = commits.get(c3.sha)!;
    expect(commit.message).toBe(
      "Update Sermon: C\n\nCo-authored-by: Pastor Example <pastor@example.org>",
    );
    expect(commit.author).toBeUndefined();
  });
});

// Runs last: it builds on the repository the commits above left behind.
describe("renaming an entry through GitHub", () => {
  const service = new ContentService(
    defineConfig({
      repo: { owner: "o", name: "r" },
      collections: {
        sermons: collection({
          label: "Sermons",
          path: "src/content/sermons/*.mdx",
          schema: { title: fields.text() },
        }),
      },
    }),
    src,
    { builtAt: "", files: {} },
  );

  it("adds the new file and removes the old one in one commit", async () => {
    const entry = (await service.getEntry("sermons", "coauthor"))!;
    const before = commits.size;
    const saved = await service.saveEntry("sermons", "coauthor", {
      data: entry.data,
      body: entry.body,
      sha: entry.sha,
      slug: "renamed",
    });

    expect(saved.path).toBe("src/content/sermons/renamed.mdx");
    expect(commits.size).toBe(before + 1);
    expect(commits.get(saved.commit)!.message).toBe("Rename Sermons: C");
    const paths = (await src.list("src/content/sermons")).map((f) => f.path);
    expect(paths).toContain("src/content/sermons/renamed.mdx");
    expect(paths).not.toContain("src/content/sermons/coauthor.mdx");
    expect(await text("src/content/sermons/renamed.mdx")).toContain("title: C");
  });
});

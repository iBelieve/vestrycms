/**
 * Runs GitHubSource.commit against an in-process fake of the Git Data API,
 * checking the blob → tree → commit → ref sequence and payloads.
 */
import { createServer } from "node:http";
import { GitHubSource } from "../src/core/sources/github.ts";
import { base64Decode, toText } from "../src/core/source.ts";

const blobs = new Map<string, Uint8Array>();
const trees = new Map<
  string,
  { path: string; sha: string | null; type: string; mode: string }[]
>();
const commits = new Map<
  string,
  { tree: string; parents: string[]; message: string }
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
    return json(200, {
      sha: p.slice(11),
      truncated: false,
      tree: trees.get(p.slice(11)),
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
const port = (server.address() as { port: number }).port;

const src = new GitHubSource({
  owner: "o",
  repo: "r",
  branch: "main",
  token: "tok",
  apiBase: `http://127.0.0.1:${port}`,
});
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok   ${msg}`);
};

assert((await src.head()) === baseCommit, "head resolves");
assert(
  (await src.list("src/content/sermons")).length === 1,
  "list filters by directory",
);
assert(
  toText((await src.read("src/content/sermons/old.mdx"))!.bytes).includes(
    "Old",
  ),
  "read blob",
);
const png = new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]);
const c1 = await src.commit(
  [
    { path: "src/content/sermons/new.mdx", content: "---\ntitle: New\n---\n" },
    { path: "src/assets/x.png", content: png },
    { path: "README.md", delete: true },
  ],
  { message: "Create Sermon: New" },
);
assert(head === c1.sha, "ref updated to new commit");
assert(
  commits.get(c1.sha)!.parents[0] === baseCommit,
  "commit parents = previous head",
);
assert(commits.get(c1.sha)!.message === "Create Sermon: New", "commit message");
const t = trees.get(commits.get(c1.sha)!.tree)!;
assert(
  !t.some((e) => e.path === "README.md"),
  "deleted path removed from tree",
);
assert(
  t.some((e) => e.path === "src/assets/x.png"),
  "binary added to tree",
);
assert((await src.head()) === c1.sha, "cached head advanced without refetch");
const back = await src.read("src/assets/x.png");
assert(
  back!.bytes.length === png.length &&
    back!.bytes.every((b, i) => b === png[i]),
  "binary round-trips via cache",
);
const c2 = await src.commit(
  [
    {
      path: "src/content/sermons/new.mdx",
      content: "---\ntitle: Newer\n---\n",
    },
  ],
  { message: "Update" },
);
assert(
  commits.get(c2.sha)!.parents[0] === c1.sha,
  "second commit chains on first",
);
assert(
  toText((await src.read("src/content/sermons/new.mdx"))!.bytes).includes(
    "Newer",
  ),
  "read after update sees new content",
);
const order = log
  .filter((l) => l.startsWith("POST") || l.startsWith("PATCH"))
  .slice(0, 5)
  .join(" → ");
assert(
  order ===
    "POST /repos/o/r/git/blobs → POST /repos/o/r/git/blobs → POST /repos/o/r/git/trees → POST /repos/o/r/git/commits → PATCH /repos/o/r/git/refs/heads/main",
  `write sequence: ${order}`,
);
// Simulate someone else pushing: a stale cached head must surface as a conflict.
head = baseCommit;
let conflict = false;
try {
  await src.commit([{ path: "a.txt", content: "x" }], { message: "stale" });
} catch (e) {
  conflict = (e as { code?: string }).code === "conflict";
}
assert(conflict, "non-fast-forward ref update reported as conflict");
server.close();
console.log("all GitHub mock tests passed");

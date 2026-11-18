/**
 * Exercises GitHubSource.commit on a throwaway branch, then deletes it.
 * Needs GH_TOKEN with push access. Never touches real branches.
 */
import { GitHubSource } from "../../src/core/sources/github.js";
import { toText } from "../../src/core/source.js";

const token = process.env.GH_TOKEN!;
const owner = "iBelieve";
const repo = "mluther.org";
const branch = `vestry-scratch-${Date.now()}`;
const api = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "vestry-test",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok && res.status !== 204)
    throw new Error(`${res.status} ${path}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

const master = (await api(`/repos/${owner}/${repo}/git/ref/heads/master`)) as {
  object: { sha: string };
};
await api(`/repos/${owner}/${repo}/git/refs`, {
  method: "POST",
  body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: master.object.sha }),
});
console.log("created branch", branch);
try {
  const src = new GitHubSource({ owner, repo, branch, token });
  const before = await src.head();
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
  const commit = await src.commit(
    [
      {
        path: "src/content/sermons/_vestry-test.mdx",
        content: "---\ntitle: Test\n---\n\nHello from Vestry.\n",
      },
      { path: "src/assets/covers/_vestry-test.png", content: png },
      { path: "README.md", delete: true },
    ],
    { message: "Vestry write test" },
  );
  console.log("commit", commit.sha, commit.url);
  const after = await src.head();
  console.log("head advanced", before !== after && after === commit.sha);
  const file = await src.read("src/content/sermons/_vestry-test.mdx");
  console.log("read back", JSON.stringify(toText(file!.bytes)));
  const bin = await src.read("src/assets/covers/_vestry-test.png");
  console.log(
    "binary ok",
    bin!.bytes.length === png.length &&
      bin!.bytes.every((b, i) => b === png[i]),
  );
  console.log("README deleted", (await src.read("README.md")) === null);
  // Second commit on top (uses cached head updated by the first commit).
  const c2 = await src.commit(
    [{ path: "src/content/sermons/_vestry-test.mdx", delete: true }],
    { message: "Vestry write test 2" },
  );
  console.log("commit 2 parent chain ok", c2.sha !== commit.sha);
} finally {
  await api(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "DELETE",
  });
  console.log("deleted branch", branch);
}

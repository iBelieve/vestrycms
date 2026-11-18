/**
 * Deploy status: the per-commit states worked out from check runs, the
 * GitHub GraphQL query that reads them, and the /deploys route.
 */
import { createServer } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { defineConfig } from "../src/config/index.js";
import { validateConfig } from "../src/config/validate.js";
import { createApi } from "../src/core/api.js";
import { MemoryCache } from "../src/core/cache.js";
import { deployStatus, type DeployStatus } from "../src/core/deploys.js";
import type {
  ContentSource,
  SourceCheckRun,
  SourceCommit,
} from "../src/core/source.js";
import { GitHubSource } from "../src/core/sources/github.js";

const NOW = Date.parse("2026-11-18T12:00:00Z");
/** An ISO time `minutes` before NOW. */
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function run(
  status: SourceCheckRun["status"],
  conclusion: string | null = null,
  started = 0,
  finished = 0,
  name = "Workers Builds: site",
): SourceCheckRun {
  return {
    name,
    status,
    conclusion,
    startedAt: status === "queued" ? null : ago(started),
    completedAt: status === "completed" ? ago(finished) : null,
    url: "https://dash.cloudflare.com/build/1",
  };
}

let n = 0;
function commit(
  minutesAgo: number,
  checks: SourceCheckRun[] = [],
  message = "Update page",
): SourceCommit {
  const sha = `c${++n}`;
  return {
    sha,
    title: message.split("\n")[0],
    message,
    date: ago(minutesAgo),
    url: `https://github.com/o/r/commit/${sha}`,
    author: { name: "vestry[bot]", email: "bot@example.org" },
    checks,
  };
}

/** The status, which must be available. */
function status(
  commits: SourceCommit[],
  options: Parameters<typeof deployStatus>[1] = {},
) {
  const result = deployStatus(commits, { now: NOW, ...options });
  if (!result.available) throw new Error(`unavailable: ${result.reason}`);
  return result;
}
const states = (s: { commits: { state: string }[] }) =>
  s.commits.map((c) => c.state);

describe("deployStatus", () => {
  it("marks the deployed commit and everything before it live", () => {
    const s = status([
      commit(5, [run("completed", "success", 4, 2)]),
      commit(60, [run("completed", "failure", 59, 58)]),
      commit(120),
    ]);
    expect(states(s)).toEqual(["live", "live", "live"]);
    expect(s.commits.map((c) => c.current)).toEqual([true, false, false]);
    expect(s).toMatchObject({ pending: 0, failed: false });
  });

  it("shows a save in progress ahead of the live one", () => {
    const s = status([
      commit(1, [run("in_progress", null, 0.5)]),
      commit(30, [run("completed", "success", 29, 27)]),
    ]);
    expect(states(s)).toEqual(["building", "live"]);
    expect(s.pending).toBe(1);
  });

  it("waits for a build that hasn't been reported yet", () => {
    const s = status([
      commit(0.2),
      commit(30, [run("completed", "success", 29, 27)]),
    ]);
    expect(states(s)).toEqual(["waiting", "live"]);
    expect(s.pending).toBe(1);
  });

  it("carries skipped saves along with the newest build", () => {
    // Saved three times in a row: the first build runs, the second is
    // skipped for the third, which is queued behind the first.
    const s = status([
      commit(1, [run("queued")]),
      commit(1.5, [run("completed", "cancelled", 1.5, 1.5)]),
      commit(2, [run("in_progress", null, 2)]),
      commit(30, [run("completed", "success", 29, 27)]),
    ]);
    expect(states(s)).toEqual(["queued", "superseded", "building", "live"]);
    expect(s).toMatchObject({ pending: 3, failed: false });
  });

  it("counts a save with no build of its own as included in a newer one", () => {
    const s = status([
      commit(1, [run("in_progress", null, 1)]),
      commit(1.2),
      commit(30, [run("completed", "success", 29, 27)]),
    ]);
    expect(states(s)).toEqual(["building", "superseded", "live"]);
  });

  it("makes the build that finished last live, even when it is older", () => {
    const s = status([
      commit(10, [run("completed", "success", 9, 6)]),
      commit(11, [run("completed", "success", 10, 4)]),
    ]);
    expect(states(s)).toEqual(["overwritten", "live"]);
    expect(s.commits[1].current).toBe(true);
    expect(s.pending).toBe(0);
  });

  it("reports a failed build when nothing newer is coming", () => {
    const s = status([
      commit(10, [run("completed", "failure", 9, 7)]),
      commit(30, [run("completed", "success", 29, 27)]),
    ]);
    expect(states(s)).toEqual(["failed", "live"]);
    expect(s).toMatchObject({ pending: 0, failed: true });
  });

  it("doesn't call a build failed while a newer one may fix it", () => {
    const s = status([
      commit(1, [run("in_progress", null, 1)]),
      commit(10, [run("completed", "failure", 9, 7)]),
      commit(30, [run("completed", "success", 29, 27)]),
    ]);
    expect(states(s)).toEqual(["building", "failed", "live"]);
    expect(s).toMatchObject({ pending: 1, failed: false });
  });

  it("gives up waiting on a save no build was reported for", () => {
    const s = status([
      commit(45),
      commit(60, [run("completed", "success", 59, 57)]),
    ]);
    expect(states(s)).toEqual(["unknown", "live"]);
    expect(s.pending).toBe(0);
  });

  it("treats a cancelled newest build as not built, not failed", () => {
    const s = status([
      commit(5, [run("completed", "cancelled", 5, 4)]),
      commit(60, [run("completed", "success", 59, 57)]),
    ]);
    expect(states(s)).toEqual(["unknown", "live"]);
    expect(s.failed).toBe(false);
  });

  it("uses the latest run of a rerun build", () => {
    const s = status([
      commit(20, [
        run("completed", "failure", 19, 18),
        run("completed", "success", 10, 8),
      ]),
    ]);
    expect(states(s)).toEqual(["live"]);
  });

  it("matches the configured check and ignores others", () => {
    const commits = [
      commit(5, [
        run("completed", "success", 4, 2, "Build"),
        run("in_progress", null, 1, 0, "Workers Builds: other"),
        run("completed", "success", 4, 3, "Workers Builds: site"),
      ]),
    ];
    // By default any Workers Builds run counts (the latest of them), so a
    // repository with several Workers names the one that is the site.
    expect(states(status(commits))).toEqual(["building"]);
    expect(states(status(commits, { check: "Workers Builds: site" }))).toEqual([
      "live",
    ]);
    expect(deployStatus(commits, { check: "Deploy" })).toEqual({
      available: false,
      reason: "no-builds",
    });
  });

  it("credits the co-author and recognises the user's own saves", () => {
    const s = status(
      [
        commit(
          5,
          [run("completed", "success", 4, 2)],
          "Update page\n\nCo-authored-by: Seth G <Seth@Example.org>",
        ),
        commit(6),
      ],
      { email: "seth@example.org" },
    );
    expect(s.commits.map((c) => [c.author, c.mine])).toEqual([
      ["Seth G", true],
      ["vestry[bot]", false],
    ]);
  });

  it("takes the typical time from save to live from past builds", () => {
    const s = status([
      commit(10, [run("completed", "success", 9, 8)]),
      commit(20, [run("completed", "success", 19, 17)]),
      commit(30, [run("completed", "success", 29, 26)]),
    ]);
    expect(s.typicalSeconds).toBe(180);
  });

  it("drops build links that aren't https", () => {
    const check = run("completed", "success", 4, 2);
    check.url = "javascript:alert(1)";
    expect(status([commit(5, [check])]).commits[0].buildUrl).toBeNull();
  });
});

// ------------------------------------------------------------ GitHub

let graphql: { status: number; body: unknown } = { status: 200, body: {} };
const queries: { variables: Record<string, unknown> }[] = [];
// oxlint-disable-next-line typescript/no-misused-promises -- a failure here fails the test.
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  if (req.url === "/api/graphql" && req.method === "POST") {
    queries.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(graphql.status, { "content-type": "application/json" });
    return res.end(JSON.stringify(graphql.body));
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: `unhandled ${req.url}` }));
});
await new Promise<void>((r) => server.listen(0, r));
afterAll(() => void server.close());
const port = (server.address() as { port: number }).port;

/** A GitHub Enterprise-style base, so GraphQL is at /api/graphql. */
const source = () =>
  new GitHubSource({
    owner: "o",
    repo: "r",
    branch: "main",
    token: "tok",
    apiBase: `http://127.0.0.1:${port}/api/v3`,
    cache: new MemoryCache(),
  });

const historyNode = {
  oid: "abc",
  messageHeadline: "Update page",
  message: "Update page\n\nCo-authored-by: Ann <ann@example.org>",
  committedDate: "2026-11-18T11:58:00Z",
  url: "https://github.com/o/r/commit/abc",
  author: { name: "vestry[bot]", email: "bot@example.org" },
  checkSuites: {
    nodes: [
      { checkRuns: { nodes: [] } },
      {
        checkRuns: {
          nodes: [
            {
              name: "Workers Builds: site",
              status: "IN_PROGRESS",
              conclusion: null,
              startedAt: "2026-11-18T11:58:30Z",
              completedAt: null,
              detailsUrl: "https://dash.cloudflare.com/x",
            },
          ],
        },
      },
    ],
  },
};

describe("GitHubSource.recentCommits", () => {
  it("reads the branch's commits and check runs in one query", async () => {
    graphql = {
      status: 200,
      body: {
        data: {
          repository: {
            ref: { target: { history: { nodes: [historyNode] } } },
          },
        },
      },
    };
    queries.length = 0;
    const src = source();
    const commits = await src.recentCommits(10);
    expect(queries).toHaveLength(1);
    expect(queries[0].variables).toEqual({
      owner: "o",
      name: "r",
      ref: "refs/heads/main",
      limit: 10,
    });
    expect(commits).toEqual([
      {
        sha: "abc",
        title: "Update page",
        message: historyNode.message,
        date: historyNode.committedDate,
        url: historyNode.url,
        author: { name: "vestry[bot]", email: "bot@example.org" },
        checks: [
          {
            name: "Workers Builds: site",
            status: "in_progress",
            conclusion: null,
            startedAt: "2026-11-18T11:58:30Z",
            completedAt: null,
            url: "https://dash.cloudflare.com/x",
          },
        ],
      },
    ]);
    // Cached for a few seconds, so polling editors share one request.
    await src.recentCommits(10);
    expect(queries).toHaveLength(1);
  });

  it("returns nothing for a branch that doesn't exist", async () => {
    graphql = { status: 200, body: { data: { repository: { ref: null } } } };
    expect(await source().recentCommits(10)).toEqual([]);
  });

  it("reports a missing Checks permission", async () => {
    graphql = {
      status: 200,
      body: {
        data: null,
        errors: [
          {
            type: "FORBIDDEN",
            message: "Resource not accessible by integration",
            path: ["repository", "ref", "target", "history"],
          },
        ],
      },
    };
    await expect(source().recentCommits(10)).rejects.toMatchObject({
      status: 403,
      code: "checks_forbidden",
    });
  });

  it("reports other GraphQL errors", async () => {
    graphql = {
      status: 200,
      body: { data: null, errors: [{ message: "Something broke" }] },
    };
    await expect(source().recentCommits(10)).rejects.toThrow(
      "GitHub GraphQL: Something broke",
    );
  });
});

// ------------------------------------------------------------ route

const config = defineConfig({ repo: { owner: "o", name: "r" } });

function fakeSource(recentCommits?: ContentSource["recentCommits"]) {
  return {
    info: () => ({ kind: "github" as const, label: "o/r" }),
    head: async () => "head",
    list: async () => [],
    read: async () => null,
    commit: async () => ({ sha: "x" }),
    recentCommits,
  } satisfies ContentSource;
}

async function getDeploys(
  source: ContentSource,
  cfg = config,
): Promise<DeployStatus> {
  const api = createApi({
    config: cfg,
    index: { builtAt: "", files: {} },
    basePath: "/admin",
    env: () => undefined,
    localSource: source,
  });
  const res = await api.handle(
    new Request("http://localhost/admin/api/deploys"),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as DeployStatus;
}

describe("GET /deploys", () => {
  it("is unavailable for a source without builds", async () => {
    expect(await getDeploys(fakeSource())).toEqual({
      available: false,
      reason: "local",
    });
  });

  it("is off when the config turns it off", async () => {
    const off = defineConfig({ ...config, deploys: false });
    const source = fakeSource(async () => [commit(1)]);
    expect(await getDeploys(source, off)).toEqual({
      available: false,
      reason: "disabled",
    });
  });

  it("says when the GitHub App can't read checks", async () => {
    const src = source();
    graphql = {
      status: 200,
      body: { errors: [{ type: "FORBIDDEN", message: "no" }] },
    };
    expect(await getDeploys(src)).toEqual({
      available: false,
      reason: "permission",
    });
  });

  it("returns the status of recent commits", async () => {
    let asked = 0;
    const source = fakeSource(async (limit) => {
      asked = limit;
      return [commit(1, [run("in_progress", null, 1)])];
    });
    const result = await getDeploys(source);
    expect(asked).toBe(10);
    expect(result).toMatchObject({ available: true, pending: 1 });
  });
});

describe("deploys config", () => {
  it("accepts false or a check name", () => {
    expect(() =>
      validateConfig(defineConfig({ ...config, deploys: false })),
    ).not.toThrow();
    expect(() =>
      validateConfig(
        defineConfig({ ...config, deploys: { check: "Workers Builds: x" } }),
      ),
    ).not.toThrow();
  });

  it("rejects an empty check name", () => {
    expect(() =>
      validateConfig(defineConfig({ ...config, deploys: { check: " " } })),
    ).toThrow("deploys.check");
  });
});

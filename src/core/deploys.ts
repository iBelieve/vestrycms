/**
 * Build and deploy status of recent saves, read from the check runs a host
 * posts on each commit (Cloudflare Workers Builds posts one named
 * "Workers Builds: <worker>"). Everything here is derived from the
 * repository, so it survives a reload and covers saves made elsewhere.
 *
 * Every build deploys the whole tree at its commit, so once a build is live,
 * so is every commit before it. The live commit is the one whose successful
 * build finished last: builds may run side by side and finish out of order,
 * and the last deploy is the one the site serves.
 *
 * Saves in quick succession don't each get a build: Workers Builds (and
 * Pages) skip a queued build when a newer one for the same Worker is queued,
 * so the running build finishes and then the newest commit builds. A commit
 * whose build was skipped, or never reported, rides along with a newer one.
 */
import type { DeploysConfig, VestryConfig } from "../config/types.js";
import type { SourceCheckRun, SourceCommit } from "./source.js";

/**
 * - `live`: this commit's changes are on the site (it, or a later commit, was deployed last).
 * - `waiting`: no build has started for it yet.
 * - `queued` / `building`: its build is waiting for a runner, or running.
 * - `superseded`: it gets no build of its own (skipped, or none reported),
 *   but a newer commit's build, coming or running, includes it.
 * - `failed`: its build failed or timed out.
 * - `overwritten`: it was deployed, but a build of an older commit deployed after it.
 * - `unknown`: its build was cancelled or skipped, or none was reported long
 *   after it was saved (or before a newer commit's build settled), and
 *   nothing newer is on the way.
 */
export type DeployState =
  | "live"
  | "waiting"
  | "queued"
  | "building"
  | "superseded"
  | "failed"
  | "overwritten"
  | "unknown";

export interface DeployCommit {
  sha: string;
  title: string;
  date: string;
  url: string | null;
  /** Who made the change: the co-author Vestry credits, or the commit's author. */
  author: string;
  /** Saved by the user asking. */
  mine: boolean;
  state: DeployState;
  /** When its build started and finished, if it has one. */
  buildStartedAt: string | null;
  buildFinishedAt: string | null;
  /** Link to its build log (https only). */
  buildUrl: string | null;
}

export type DeployStatus =
  | {
      available: true;
      commits: DeployCommit[];
      /** Commits whose changes are on their way: not live yet, with a build to come or running. */
      pending: number;
      /** The newest commit's build failed, and nothing newer is on its way or live. */
      failed: boolean;
      /** Typical time from save to live, in seconds, from recent builds. */
      typicalSeconds: number | null;
      /** Typical time a build runs, start to finish, in seconds, from recent builds. */
      typicalBuildSeconds: number | null;
    }
  | {
      available: false;
      /**
       * - `local`: editing local files; nothing is built.
       * - `disabled`: `deploys: false` in the config.
       * - `permission`: the GitHub App cannot read check runs.
       * - `no-builds`: no recent commit has a matching check run.
       */
      reason: "local" | "disabled" | "permission" | "no-builds";
    };

/** Check-run name prefixes that mean "this commit was built and deployed". */
const DEFAULT_DEPLOY_CHECKS = ["Workers Builds", "Cloudflare Pages"];

/** How many commits the status covers. */
export const DEPLOY_HISTORY = 10;

/** A save with no build reported this long after it is `unknown`, not `waiting`. */
const NO_BUILD_AFTER_MS = 30 * 60 * 1000;

/** Conclusions of a build that broke (as opposed to one that was cancelled or skipped). */
const FAILED = new Set([
  "failure",
  "timed_out",
  "action_required",
  "startup_failure",
]);

/** States of a commit whose changes are on their way to the site. */
const ON_THE_WAY = new Set<DeployState>([
  "waiting",
  "queued",
  "building",
  "superseded",
]);

/** The deploy settings, or null when deploy status is turned off. */
export function deploysConfig(config: VestryConfig): DeploysConfig | null {
  if (config.deploys === false) return null;
  return config.deploys ?? {};
}

/**
 * The status of each commit's deploy. `commits` is newest first, as the
 * branch's history lists them.
 */
export function deployStatus(
  commits: SourceCommit[],
  options: { check?: string; email?: string | null; now?: number } = {},
): DeployStatus {
  const check = options.check?.trim();
  const prefixes = check ? [check] : DEFAULT_DEPLOY_CHECKS;
  const builds = commits.map((c) => deployCheck(c.checks, prefixes));
  if (!builds.some(Boolean)) return { available: false, reason: "no-builds" };
  const now = options.now ?? Date.now();
  const live = liveIndex(builds);
  const email = options.email?.toLowerCase() || null;

  // Newest first, so each commit knows what became of the newer ones.
  let newer: Newer = "none";
  const out = commits.map((commit, i): DeployCommit => {
    const build = builds[i];
    const author = creditedAuthor(commit);
    let state: DeployState = "live";
    if (live < 0 || i < live) {
      state = pendingState(build, Date.parse(commit.date), now, newer);
      if (ON_THE_WAY.has(state)) newer = "coming";
      else if (newer === "none") newer = "settled";
    }
    return {
      sha: commit.sha,
      title: commit.title,
      date: commit.date,
      url: commit.url,
      author: author.name,
      mine: Boolean(email && author.email?.toLowerCase() === email),
      state,
      buildStartedAt: build?.startedAt ?? null,
      buildFinishedAt: build?.completedAt ?? null,
      buildUrl: safeUrl(build?.url ?? null),
    };
  });

  const ahead = live >= 0 ? out.slice(0, live) : out;
  const pending = ahead.filter((c) => ON_THE_WAY.has(c.state)).length;
  return {
    available: true,
    commits: out,
    pending,
    // A failure only stands while no newer build is on its way to replace it.
    failed: !pending && ahead[0]?.state === "failed",
    typicalSeconds: medianSeconds(builds, (_, i) => commits[i].date),
    typicalBuildSeconds: medianSeconds(builds, (build) => build.startedAt),
  };
}

/**
 * The commit's deploy check: the most recent run whose name starts with one
 * of the prefixes (a rerun adds a run with the same name).
 */
function deployCheck(
  checks: SourceCheckRun[],
  prefixes: string[],
): SourceCheckRun | null {
  let best: SourceCheckRun | null = null;
  for (const check of checks) {
    if (!prefixes.some((p) => check.name.startsWith(p))) continue;
    if (!best || runTime(check) >= runTime(best)) best = check;
  }
  return best;
}

/** When a run started; a run that hasn't started is the newest. */
function runTime(check: SourceCheckRun): number {
  return check.startedAt ? Date.parse(check.startedAt) : Infinity;
}

/** The index of the commit deployed last: the successful build that finished last. */
function liveIndex(builds: (SourceCheckRun | null)[]): number {
  let index = -1;
  let finished = -Infinity;
  builds.forEach((build, i) => {
    if (build?.status !== "completed" || build.conclusion !== "success") return;
    const at = build.completedAt ? Date.parse(build.completedAt) : 0;
    // Ties go to the newer commit, which includes the older one.
    if (at > finished) {
      index = i;
      finished = at;
    }
  });
  return index;
}

/**
 * What became of the commits newer than one that isn't live:
 * - `none`: there are none (it is the newest not-live commit).
 * - `coming`: a newer build is on its way, and includes this commit.
 * - `settled`: the newer ones settled (failed, cancelled, overwritten)
 *   without going live, so no build is coming for this commit either.
 */
type Newer = "none" | "coming" | "settled";

/** The state of a commit whose changes are not live. */
function pendingState(
  build: SourceCheckRun | null,
  savedAt: number,
  now: number,
  newer: Newer,
): DeployState {
  if (build?.status === "queued") return "queued";
  if (build?.status === "in_progress") return "building";
  if (build?.conclusion === "success") return "overwritten";
  if (build?.conclusion && FAILED.has(build.conclusion)) return "failed";
  // Cancelled, skipped or no build at all: a newer build carries it.
  if (newer === "coming") return "superseded";
  // Only a commit with nothing newer may still be waiting for its build to
  // be reported; under a settled one, none is coming.
  if (!build && newer === "none")
    return now - savedAt > NO_BUILD_AFTER_MS ? "unknown" : "waiting";
  return "unknown";
}

/**
 * The editor Vestry credited as co-author of its GitHub App's commit, or
 * the commit's author. Only the app's (bot) commits are credited this way:
 * a person's commit can carry a co-author too, such as a coding assistant.
 */
function creditedAuthor(commit: SourceCommit): {
  name: string;
  email: string | null;
} {
  if (!commit.author.name.includes("[bot]")) return commit.author;
  const trailers = [
    ...commit.message.matchAll(/^Co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim),
  ];
  const last = trailers.at(-1);
  if (last) return { name: last[1], email: last[2] };
  return commit.author;
}

/**
 * The median time, in seconds, from `from` (the commit's save, or the
 * build's start) to finishing, among the successful builds.
 */
function medianSeconds(
  builds: (SourceCheckRun | null)[],
  from: (build: SourceCheckRun, i: number) => string | null,
): number | null {
  const times = builds
    .map((build, i) => {
      if (build?.conclusion !== "success" || !build.completedAt) return NaN;
      const start = from(build, i);
      if (!start) return NaN;
      return (Date.parse(build.completedAt) - Date.parse(start)) / 1000;
    })
    .filter((s) => Number.isFinite(s) && s > 0)
    .sort((a, b) => a - b);
  if (!times.length) return null;
  return Math.round(times[Math.floor(times.length / 2)]);
}

/** Only https links from a check run are shown; anything else is dropped. */
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

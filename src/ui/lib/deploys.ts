import type {
  DeployCommit,
  DeployState,
  DeployStatus,
} from "../../core/deploys.js";

/**
 * What each commit's state is called in the list. Waiting for a build,
 * queued and riding along with a newer build all mean the same to an
 * editor: the change goes out with the next build.
 */
export const STATE_LABELS: Record<DeployState, string> = {
  live: "Live",
  waiting: "Waiting",
  queued: "Waiting",
  building: "Publishing",
  superseded: "Waiting",
  failed: "Couldn't publish",
  overwritten: "Replaced by an earlier change",
  unknown: "Not published",
};

/** The top bar's summary of the deploy status. */
export interface DeploySummary {
  tone: "busy" | "ok" | "bad";
  label: string;
}

export function deploySummary(
  status: Extract<DeployStatus, { available: true }>,
): DeploySummary {
  if (status.pending > 0) {
    return {
      tone: "busy",
      label:
        status.pending > 1
          ? `Publishing ${status.pending} changes`
          : "Publishing",
    };
  }
  if (status.failed) return { tone: "bad", label: "Couldn't publish" };
  // Nothing is on its way, but the newest change may still not be live: its
  // build was cancelled or never reported, or an older build deployed after it.
  if (!newestIsLive(status)) return { tone: "bad", label: "Not live" };
  return { tone: "ok", label: "Live" };
}

/** Whether the newest commit's changes are on the site. */
export function newestIsLive(
  status: Extract<DeployStatus, { available: true }>,
): boolean {
  return status.commits[0]?.state === "live";
}

/** How often to ask again: often while something is on its way, rarely otherwise. */
export function pollInterval(status: DeployStatus | undefined): number | false {
  if (!status) return 60_000;
  if (!status.available) return status.reason === "no-builds" ? 60_000 : false;
  return status.pending > 0 ? 5_000 : 60_000;
}

/** `12 sec ago`, `3 min ago`, `2 hr ago`, then the date. */
export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** `under a minute`, `about 2 min`. */
export function aboutDuration(seconds: number): string {
  if (seconds < 60) return "under a minute";
  return `about ${Math.round(seconds / 60)} min`;
}

type SectionKey = "waiting" | "building" | "stuck" | "live";

/** A titled group of commits in the open list. */
export interface CommitGroup {
  key: SectionKey;
  title: string;
  commits: DeployCommit[];
}

/** The list's sections, in order. */
const SECTIONS: { key: SectionKey; title: string }[] = [
  { key: "waiting", title: "Waiting to publish" },
  { key: "building", title: "Publishing now" },
  { key: "stuck", title: "Not published" },
  { key: "live", title: "On the site" },
];

/**
 * The section each state goes in. A superseded commit has no build of its
 * own, so it goes with the newer build that carries it.
 */
const SECTION_OF: Record<Exclude<DeployState, "superseded">, SectionKey> = {
  waiting: "waiting",
  queued: "waiting",
  building: "building",
  failed: "stuck",
  unknown: "stuck",
  overwritten: "stuck",
  live: "live",
};

/** The commits by section, leaving out empty sections. */
export function groupCommits(commits: DeployCommit[]): CommitGroup[] {
  const grouped: Record<SectionKey, DeployCommit[]> = {
    waiting: [],
    building: [],
    stuck: [],
    live: [],
  };
  // Newest first, so a superseded commit follows the nearest newer build
  // coming or running: publishing now if that build is already running.
  let carrier: SectionKey = "waiting";
  for (const commit of commits) {
    const { state } = commit;
    const key: SectionKey =
      state === "superseded" ? carrier : SECTION_OF[state];
    if (key === "waiting" || key === "building") carrier = key;
    grouped[key].push(commit);
  }
  return SECTIONS.map(({ key, title }) => ({
    key,
    title,
    commits: grouped[key],
  })).filter((g) => g.commits.length > 0);
}

/**
 * How far along a running build probably is, from 0.03 to 0.95: the time
 * since it started against how long builds usually run. Null when there is
 * nothing to time it against.
 */
export function buildProgress(
  startedAt: string | null,
  typicalBuildSeconds: number | null,
  now: number,
): number | null {
  if (!startedAt || !typicalBuildSeconds) return null;
  const elapsed = (now - Date.parse(startedAt)) / 1000;
  if (!Number.isFinite(elapsed)) return null;
  return Math.min(0.95, Math.max(0.03, elapsed / typicalBuildSeconds));
}

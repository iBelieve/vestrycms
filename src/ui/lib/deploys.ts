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
  failed: "Build failed",
  overwritten: "Replaced by an older build",
  unknown: "Not built",
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
  if (status.failed) return { tone: "bad", label: "Build failed" };
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

/** A titled group of commits in the open list. */
export interface CommitGroup {
  key: string;
  title: string;
  commits: DeployCommit[];
}

/** The list's sections, in order, and the states each one holds. */
const SECTIONS: { key: string; title: string; states: DeployState[] }[] = [
  {
    key: "waiting",
    title: "Waiting to publish",
    states: ["waiting", "queued", "superseded"],
  },
  { key: "building", title: "Publishing now", states: ["building"] },
  {
    key: "stuck",
    title: "Not published",
    states: ["failed", "unknown", "overwritten"],
  },
  { key: "live", title: "On the site", states: ["live"] },
];

/** The commits by section, leaving out empty sections. */
export function groupCommits(commits: DeployCommit[]): CommitGroup[] {
  return SECTIONS.map(({ key, title, states }) => ({
    key,
    title,
    commits: commits.filter((c) => states.includes(c.state)),
  })).filter((g) => g.commits.length > 0);
}

/** How far along a running build probably is, from 0 to 0.95. */
export function buildProgress(
  startedAt: string | null,
  typicalSeconds: number | null,
  now: number,
): number | null {
  if (!startedAt || !typicalSeconds) return null;
  const elapsed = (now - Date.parse(startedAt)) / 1000;
  return Math.min(0.95, Math.max(0.03, elapsed / typicalSeconds));
}

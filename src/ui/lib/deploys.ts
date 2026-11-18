import type { DeployState, DeployStatus } from "../../core/deploys.js";

/** What each commit's state is called in the list. */
export const STATE_LABELS: Record<DeployState, string> = {
  live: "Live",
  waiting: "Waiting to build",
  queued: "Queued",
  building: "Building",
  superseded: "In the next build",
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
  return { tone: "ok", label: "Live" };
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

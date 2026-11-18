import { useQuery } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleDashed,
  CircleExclamationPoint,
  CircleSlash,
  Clock,
  ExternalLink,
  Layers,
  LoaderCircle,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DeployCommit, DeployState } from "../../core/deploys.js";
import type { DeployStatus as Status } from "../api.js";
import { useVestry } from "../context.js";
import {
  aboutDuration,
  deploySummary,
  pollInterval,
  STATE_LABELS,
  timeAgo,
} from "../lib/deploys.js";
import { cx } from "../lib/utils.js";
import { Menu, useToast } from "./ui.js";

type Available = Extract<Status, { available: true }>;

const STATE_ICONS: Record<DeployState, ReactNode> = {
  live: <CircleCheck />,
  waiting: <Clock />,
  queued: <Clock />,
  building: <LoaderCircle className="v-deploys__spin" />,
  superseded: <Layers />,
  failed: <CircleExclamationPoint />,
  overwritten: <Undo2 />,
  unknown: <CircleSlash />,
};

/**
 * The top bar's build status: whether the latest saves are live on the
 * site, opening a list of recent saves and their builds. Read from the
 * repository's check runs, so it survives a reload.
 */
export function DeployStatus() {
  const { api, client } = useVestry();
  const query = useQuery({
    queryKey: ["deploys"],
    queryFn: () => api.deploys(),
    refetchInterval: (q) => pollInterval(q.state.data),
    retry: false,
  });
  const status = query.data;
  useLiveToast(status);
  if (!status) return null;
  if (!status.available) {
    return status.reason === "permission" && client.user?.role === "admin" ? (
      <span
        className="v-chrome__chip"
        title="Vestry can't read build checks. Give its GitHub App the Checks: Read-only permission."
      >
        <CircleDashed />
        <span>Build status off</span>
      </span>
    ) : null;
  }
  return <DeployMenu status={status} />;
}

function DeployMenu({ status }: { status: Available }) {
  const summary = deploySummary(status);
  const now = useNow(status.pending > 0 ? 1_000 : 30_000);
  return (
    <Menu
      align="right"
      trigger={({ toggle }) => (
        <button
          type="button"
          className={cx("v-chrome__chip v-deploys__chip", `is-${summary.tone}`)}
          onClick={toggle}
          title="Site builds"
        >
          {summary.tone === "busy" ? (
            <LoaderCircle className="v-deploys__spin" />
          ) : summary.tone === "bad" ? (
            <CircleExclamationPoint />
          ) : (
            <CircleCheck />
          )}
          <span>{summary.label}</span>
        </button>
      )}
    >
      {() => (
        <div className="v-deploys">
          <div className="v-menu__heading">Site builds</div>
          <p className="v-deploys__lead">{leadText(status)}</p>
          <ul className="v-deploys__list">
            {status.commits.map((c) => (
              <CommitRow key={c.sha} commit={c} now={now} />
            ))}
          </ul>
        </div>
      )}
    </Menu>
  );
}

function leadText(status: Available): string {
  const typical = status.typicalSeconds
    ? ` Builds usually take ${aboutDuration(status.typicalSeconds)}.`
    : "";
  if (status.pending > 0) {
    const changes =
      status.pending === 1 ? "1 change is" : `${status.pending} changes are`;
    return `${changes} on the way to the site.${typical}`;
  }
  if (status.failed)
    return "The last build failed, so the site still shows the change marked live. Open the build log to see why.";
  return "Every change below is live on the site.";
}

function CommitRow({ commit, now }: { commit: DeployCommit; now: number }) {
  const link = commit.buildUrl ?? commit.url;
  const when =
    commit.state === "building" && commit.buildStartedAt
      ? `started ${timeAgo(commit.buildStartedAt, now)}`
      : timeAgo(commit.date, now);
  return (
    <li className={cx("v-deploys__row", `is-${commit.state}`)}>
      <span className="v-deploys__icon" title={STATE_LABELS[commit.state]}>
        {STATE_ICONS[commit.state]}
      </span>
      <span className="v-deploys__body">
        <span className="v-deploys__title">
          {link ? (
            <a href={link} target="_blank" rel="noreferrer">
              {commit.title}
              <ExternalLink />
            </a>
          ) : (
            commit.title
          )}
        </span>
        <small>
          {commit.mine ? "You" : commit.author} · {when} ·{" "}
          <span className="v-deploys__state">
            {commit.current ? "On the site now" : STATE_LABELS[commit.state]}
          </span>
        </small>
      </span>
    </li>
  );
}

/** The current time, updated every `ms`. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Tells the editor when the changes they watched publishing go live, or fail. */
function useLiveToast(status: Status | undefined) {
  const toast = useToast();
  const wasPending = useRef(false);
  const pending = status?.available ? status.pending : 0;
  const failed = status?.available ? status.failed : false;
  useEffect(() => {
    if (!status?.available) return;
    if (wasPending.current && pending === 0) {
      if (failed) toast("error", "The site build failed");
      else toast("success", "Your changes are live on the site");
    }
    wasPending.current = pending > 0;
  }, [status, pending, failed, toast]);
}

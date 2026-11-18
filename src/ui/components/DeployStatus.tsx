import { useQuery } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleDashed,
  CircleExclamationPoint,
  CircleSlash,
  Clock,
  ExternalLink,
  LoaderCircle,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DeployCommit, DeployState } from "../../core/deploys.js";
import type { DeployStatus as Status } from "../api.js";
import { useVestry } from "../context.js";
import {
  aboutDuration,
  buildProgress,
  deploySummary,
  groupCommits,
  newestIsLive,
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
  superseded: <Clock />,
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
  return (
    <Menu
      align="right"
      trigger={({ toggle }) => (
        <button
          type="button"
          className={cx("v-chrome__chip v-deploys__chip", `is-${summary.tone}`)}
          onClick={toggle}
          title="Publishing status"
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
      {() => <DeployList status={status} />}
    </Menu>
  );
}

/** The open menu: its clock only ticks while it is shown. */
function DeployList({ status }: { status: Available }) {
  const now = useNow(status.pending > 0 ? 1_000 : 30_000);
  return (
    <div className="v-deploys">
      <div className="v-menu__heading">Publishing</div>
      <p className="v-deploys__lead">{leadText(status)}</p>
      {groupCommits(status.commits).map((group) => (
        <section key={group.key} className="v-deploys__group">
          <h4 className="v-deploys__group-title">{group.title}</h4>
          <ul className="v-deploys__list">
            {group.commits.map((c) => (
              <CommitRow
                key={c.sha}
                commit={c}
                now={now}
                typicalBuild={status.typicalBuildSeconds}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function leadText(status: Available): string {
  const typical = status.typicalSeconds
    ? ` Changes usually go live in ${aboutDuration(status.typicalSeconds)}.`
    : "";
  if (status.pending > 0) {
    const changes =
      status.pending === 1 ? "1 change is" : `${status.pending} changes are`;
    return `${changes} on the way to the site.${typical}`;
  }
  if (status.failed)
    return "The latest change couldn't be published, so the site still shows the changes under On the site. Open it to see why.";
  if (!newestIsLive(status))
    return "The latest change isn't on the site yet. Saving again will publish it.";
  return "Every change below is on the site.";
}

function CommitRow({
  commit,
  now,
  typicalBuild,
}: {
  commit: DeployCommit;
  now: number;
  typicalBuild: number | null;
}) {
  const link = commit.buildUrl ?? commit.url;
  const building = commit.state === "building";
  const when =
    building && commit.buildStartedAt
      ? `started ${timeAgo(commit.buildStartedAt, now)}`
      : timeAgo(commit.date, now);
  const progress = building
    ? buildProgress(commit.buildStartedAt, typicalBuild, now)
    : null;
  // The section says the state; only a failure is called out on the row.
  const note = commit.state === "failed" ? STATE_LABELS.failed : null;
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
          {commit.mine ? "You" : commit.author} · {when}
          {note && (
            <>
              {" · "}
              <span className="v-deploys__state">{note}</span>
            </>
          )}
        </small>
        {progress !== null && (
          <span
            className="v-deploys__progress"
            role="progressbar"
            aria-label="Estimated build progress"
            aria-valuenow={Math.round(progress * 100)}
          >
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        )}
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
  const live = status?.available ? newestIsLive(status) : false;
  useEffect(() => {
    if (!status?.available) return;
    if (wasPending.current && pending === 0) {
      if (failed) toast("error", "Your changes couldn't be published");
      else if (live) toast("success", "Your changes are live on the site");
      else toast("error", "Your changes aren't live on the site");
    }
    wasPending.current = pending > 0;
  }, [status, pending, failed, live, toast]);
}

/** Pieces shared by the Analytics page and the dashboard's visitors card. */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type {
  AnalyticsPeriod,
  AnalyticsReport,
  AnalyticsRow,
  AnalyticsStatus,
} from "../../core/analytics/types.js";
import { useVestry } from "../context.js";
import {
  change,
  formatCount,
  formatDuration,
  formatExact,
  formatPercent,
  PREVIOUS_LABELS,
  type TotalKey,
} from "../lib/analytics.js";
import { cx } from "../lib/utils.js";
import { Alert } from "./ui.js";

/**
 * The report for a period; refreshed every five minutes while open. While a
 * newly chosen period loads, the report shown before (usually the last
 * period's) stays as placeholder data (`isPlaceholderData`), so the page can
 * keep its layout.
 */
export function useAnalytics(period: AnalyticsPeriod, enabled = true) {
  const { api } = useVestry();
  return useQuery({
    queryKey: ["analytics", period],
    queryFn: () => api.analytics(period),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
}

const STAT_FORMATS: Record<TotalKey, (n: number | null) => string> = {
  visitors: formatCount,
  visits: formatCount,
  pageviews: formatCount,
  bounceRate: formatPercent,
  visitDuration: formatDuration,
};

const STAT_LABELS: Record<TotalKey, string> = {
  visitors: "Visitors",
  visits: "Visits",
  pageviews: "Pageviews",
  bounceRate: "Bounce rate",
  visitDuration: "Visit duration",
};

/** One headline number, with how it moved since the period before. */
export function AnalyticsStat({
  report,
  stat,
  active,
  onSelect,
}: {
  report: AnalyticsReport;
  stat: TotalKey;
  active?: boolean;
  /** Makes the tile a button (the page's chart switches to it). */
  onSelect?: () => void;
}) {
  const value = report.totals[stat];
  const moved = change(stat, value, report.previous?.[stat]);
  const body = (
    <>
      <span className="v-astat__label">{STAT_LABELS[stat]}</span>
      <span
        className="v-astat__value"
        title={
          stat === "visitors" || stat === "pageviews" || stat === "visits"
            ? formatExact(value)
            : undefined
        }
      >
        {STAT_FORMATS[stat](value)}
      </span>
      {moved && (
        <span
          className={cx(
            "v-astat__change",
            moved.good === true && "is-good",
            moved.good === false && "is-bad",
          )}
          title={`Compared with ${PREVIOUS_LABELS[report.period]}`}
        >
          {moved.direction === "up" ? (
            <ArrowUpRight />
          ) : moved.direction === "down" ? (
            <ArrowDownRight />
          ) : (
            <Minus />
          )}
          {moved.label}
        </span>
      )}
    </>
  );
  if (!onSelect) return <div className="v-astat">{body}</div>;
  return (
    <button
      type="button"
      className={cx("v-astat", "v-astat--button", active && "is-active")}
      aria-pressed={active}
      onClick={onSelect}
    >
      {body}
    </button>
  );
}

/**
 * A ranked list with a bar behind each row, scaled to the top row: pages,
 * sources, countries or devices.
 */
export function Breakdown({
  title,
  rows,
  label = "Visitors",
  empty = "No visits yet.",
  href,
}: {
  title: string;
  rows: AnalyticsRow[];
  label?: string;
  empty?: string;
  /** Where a row links, e.g. the page on the site. */
  href?: (row: AnalyticsRow) => string | null;
}) {
  const max = Math.max(1, ...rows.map((r) => r.visitors));
  return (
    <div className="v-card v-breakdown">
      <div className="v-breakdown__head">
        <h3>{title}</h3>
        <span>{label}</span>
      </div>
      {rows.length ? (
        <ol className="v-breakdown__rows">
          {rows.map((row) => (
            <BreakdownRow
              key={row.name}
              row={row}
              share={row.visitors / max}
              href={href?.(row) ?? null}
            />
          ))}
        </ol>
      ) : (
        <p className="v-breakdown__empty">{empty}</p>
      )}
    </div>
  );
}

function BreakdownRow({
  row,
  share,
  href,
}: {
  row: AnalyticsRow;
  share: number;
  href: string | null;
}) {
  const name = row.name || "(none)";
  return (
    <li className="v-breakdown__row">
      <span
        className="v-breakdown__bar"
        style={{ width: `${Math.max(share * 100, 1)}%` }}
      />
      <span className="v-breakdown__name" title={name}>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {name}
          </a>
        ) : (
          name
        )}
      </span>
      <span className="v-breakdown__value" title={formatExact(row.visitors)}>
        {formatCount(row.visitors)}
      </span>
    </li>
  );
}

/** Why analytics can't be shown: a missing secret, said plainly to admins. */
export function AnalyticsUnavailableNote({
  status,
}: {
  status: AnalyticsStatus;
}) {
  const { client } = useVestry();
  if (status.available || status.reason === "disabled") return null;
  return (
    <Alert kind="warning">
      {client.user?.role === "admin"
        ? `Analytics isn't set up yet. ${status.message ?? ""}`
        : "Analytics isn't set up yet. Ask an admin to finish setting it up."}
    </Alert>
  );
}

/** A page on the site, for linking a top page's row. */
export function sitePageUrl(
  siteUrl: string | undefined,
  path: string,
): string | null {
  if (!siteUrl || !path.startsWith("/")) return null;
  return `${siteUrl.replace(/\/$/, "")}${path}`;
}

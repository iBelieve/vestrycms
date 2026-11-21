/**
 * Plausible Analytics, through its Stats API (v2 `POST /api/v2/query`, plus
 * v1's realtime visitor count, which v2 has no equivalent of). Works with
 * plausible.io and self-hosted Plausible Community Edition alike; the key is
 * a Stats API key, kept in the `VESTRY_PLAUSIBLE_API_KEY` secret.
 */
import type { PlausibleAnalyticsConfig } from "../../config/types.js";
import { previousRange } from "./dates.js";
import {
  AnalyticsError,
  type AnalyticsContext,
  type AnalyticsPeriod,
  type AnalyticsPoint,
  type AnalyticsProvider,
  type AnalyticsRow,
  type AnalyticsTotals,
  type ProviderReport,
} from "./types.js";

export const PLAUSIBLE_API_KEY = "VESTRY_PLAUSIBLE_API_KEY";
const PLAUSIBLE_HOST = "https://plausible.io";

/** How many rows each breakdown lists. */
const BREAKDOWN_LIMIT = 10;

/** How long a request may take before the server counts as unreachable. */
const REQUEST_TIMEOUT_MS = 15_000;

const TOTAL_METRICS = [
  "visitors",
  "visits",
  "pageviews",
  "bounce_rate",
  "visit_duration",
] as const;

const INTERVALS: Record<AnalyticsPeriod, ProviderReport["interval"]> = {
  day: "hour",
  "7d": "day",
  "30d": "day",
  "6mo": "month",
  "12mo": "month",
};

type DateRange = AnalyticsPeriod | [string, string];

interface PlausibleQuery {
  metrics: readonly string[];
  date_range: DateRange;
  dimensions?: string[];
  order_by?: [string, "asc" | "desc"][];
  include?: { time_labels?: boolean };
  pagination?: { limit: number; offset?: number };
}

interface PlausibleResponse {
  results: { metrics: (number | null)[]; dimensions: string[] }[];
  meta?: { time_labels?: string[] };
  query?: { date_range?: unknown };
}

export function plausibleProvider(
  config: PlausibleAnalyticsConfig,
  { env, fetch, now = () => new Date() }: AnalyticsContext,
): AnalyticsProvider | { error: string } {
  const apiKey = env(PLAUSIBLE_API_KEY);
  if (!apiKey)
    return {
      error: `Missing environment variable: ${PLAUSIBLE_API_KEY} (a Plausible Stats API key).`,
    };
  const host = (config.host ?? PLAUSIBLE_HOST).replace(/\/+$/, "");
  const siteId = config.siteId.trim();
  const headers = { Authorization: `Bearer ${apiKey}` };

  async function query(q: PlausibleQuery): Promise<PlausibleResponse> {
    const res = await send(`${host}/api/v2/query`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ site_id: siteId, ...q }),
    });
    const body = await readReport(res);
    // A proxy or sign-in page in front of the server answers 200 with HTML.
    if (!body)
      throw new AnalyticsError(
        `Plausible at ${host} didn't answer with a Stats API report. Check that analytics.host is the Plausible server.`,
      );
    return body;
  }

  async function send(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw new AnalyticsError(
        `Couldn't reach Plausible at ${host}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) throw new AnalyticsError(await refusal(res, siteId));
    return res;
  }

  /** People on the site in the last five minutes; null if Plausible won't say. */
  async function current(): Promise<number | null> {
    try {
      const res = await send(
        `${host}/api/v1/stats/realtime/visitors?site_id=${encodeURIComponent(siteId)}`,
        { headers },
      );
      const value: unknown = await res.json();
      return typeof value === "number" ? value : null;
    } catch {
      return null;
    }
  }

  const breakdown =
    (dimension: string, metrics = ["visitors"]) =>
    (period: AnalyticsPeriod) =>
      query({
        metrics,
        date_range: period,
        dimensions: [dimension],
        order_by: [["visitors", "desc"]],
        pagination: { limit: BREAKDOWN_LIMIT },
      }).then(rows);
  const pages = breakdown("event:page", ["visitors", "pageviews"]);
  const sources = breakdown("visit:source");
  const countries = breakdown("visit:country_name");
  const devices = breakdown("visit:device");

  async function totalsWithPrevious(period: AnalyticsPeriod) {
    const res = await query({ metrics: TOTAL_METRICS, date_range: period });
    const range = resolvedRange(res.query?.date_range);
    const today = siteNow(res.query?.date_range, now())?.slice(0, 10);
    const before = previousRange(period, range, today);
    const previous = before
      ? totals(await query({ metrics: TOTAL_METRICS, date_range: before }))
      : null;
    return { totals: totals(res), previous, range };
  }

  async function series(period: AnalyticsPeriod) {
    const interval = INTERVALS[period];
    const res = await query({
      metrics: ["visitors", "pageviews"],
      date_range: period,
      dimensions: [`time:${interval}`],
      include: { time_labels: true },
    });
    const all = points(res);
    // Today's hours that haven't come yet would chart as a drop to zero.
    const until =
      period === "day" ? siteHour(res.query?.date_range, now()) : null;
    // Labels are `2026-11-20 14:00:00`; compare an ISO `T` form the same way.
    const hour = (time: string) => time.slice(0, 13).replace("T", " ");
    return {
      interval,
      series: until ? all.filter((p) => hour(p.time) <= until) : all,
    };
  }

  return {
    dashboardUrl: `${host}/${encodeURIComponent(siteId)}`,
    async report(period) {
      const [summary, chart, p, s, c, d, live] = await Promise.all([
        totalsWithPrevious(period),
        series(period),
        pages(period),
        sources(period),
        countries(period),
        devices(period),
        current(),
      ]);
      return {
        ...summary,
        ...chart,
        pages: p,
        sources: s,
        countries: c,
        devices: d,
        current: live,
      };
    },
  };
}

/** What Plausible said when it refused a request, as a sentence. */
async function refusal(res: Response, siteId: string): Promise<string> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as { error?: unknown };
      detail = typeof body.error === "string" ? body.error : text;
    } catch {
      detail = text;
    }
  } catch {
    // No body to show.
  }
  detail = detail.trim().slice(0, 300);
  if (res.status === 401 || res.status === 403)
    return `Plausible refused the API key in ${PLAUSIBLE_API_KEY} (HTTP ${res.status}). Check that it is a Stats API key with access to ${siteId}.${detail ? ` ${detail}` : ""}`;
  return `Plausible answered HTTP ${res.status}${detail ? `: ${detail}` : "."}`;
}

/** A query's answer, or null when it isn't JSON with a `results` list. */
async function readReport(res: Response): Promise<PlausibleResponse | null> {
  try {
    const body = (await res.json()) as Partial<PlausibleResponse> | null;
    return body && Array.isArray(body.results)
      ? (body as PlausibleResponse)
      : null;
  } catch {
    return null;
  }
}

const num = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** The headline numbers of an aggregate query (no dimensions: one row). */
function totals(res: PlausibleResponse): AnalyticsTotals {
  const m = res.results[0]?.metrics ?? [];
  return {
    visitors: num(m[0]) ?? 0,
    visits: num(m[1]) ?? 0,
    pageviews: num(m[2]) ?? 0,
    bounceRate: num(m[3]),
    visitDuration: num(m[4]),
  };
}

/** A breakdown's rows: the dimension, then visitors (and pageviews). */
function rows(res: PlausibleResponse): AnalyticsRow[] {
  return res.results.map(({ dimensions, metrics }) => {
    const row: AnalyticsRow = {
      name: dimensions[0] ?? "",
      visitors: num(metrics[0]) ?? 0,
    };
    if (metrics.length > 1) row.pageviews = num(metrics[1]) ?? 0;
    return row;
  });
}

/**
 * A time series with every bucket of the period, including those nobody
 * visited in (Plausible leaves them out of `results`; `time_labels` lists
 * them all).
 */
function points(res: PlausibleResponse): AnalyticsPoint[] {
  const byTime = new Map(
    res.results.map(({ dimensions, metrics }) => [
      dimensions[0],
      { visitors: num(metrics[0]) ?? 0, pageviews: num(metrics[1]) ?? 0 },
    ]),
  );
  const labels = res.meta?.time_labels ?? [...byTime.keys()].sort();
  return labels.map((time) => ({
    time,
    ...(byTime.get(time) ?? { visitors: 0, pageviews: 0 }),
  }));
}

const UTC_OFFSET = /(Z|([+-])(\d{2}):(\d{2}))$/;

/** The UTC offset at the end of an ISO time, in minutes; null without one. */
function offsetMinutes(time: unknown): number | null {
  const offset = typeof time === "string" ? UTC_OFFSET.exec(time) : null;
  if (!offset) return null;
  if (!offset[2]) return 0;
  const minutes = Number(offset[3]) * 60 + Number(offset[4]);
  return offset[2] === "-" ? -minutes : minutes;
}

/**
 * Now on the site's clock (`2026-11-20T14:05:00.000Z`, the `Z` meaningless),
 * from the UTC offsets of the resolved range Plausible echoes; null without
 * one. The end's offset comes first: a day that changes the clocks does so
 * in its first hours, so the end has the offset for the rest of it.
 */
function siteNow(range: unknown, now: Date): string | null {
  if (!Array.isArray(range)) return null;
  const minutes = offsetMinutes(range[1]) ?? offsetMinutes(range[0]);
  if (minutes === null) return null;
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** The current hour on the site's clock (`2026-11-20 14`), or null. */
export function siteHour(range: unknown, now: Date): string | null {
  const local = siteNow(range, now);
  return local && `${local.slice(0, 10)} ${local.slice(11, 13)}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * The first and last day a query covered. Plausible echoes the query with
 * its date range resolved, as times in the site's time zone
 * (`2026-11-14T00:00:00-06:00`); the dates are what matter here.
 */
export function resolvedRange(
  value: unknown,
): { start: string; end: string } | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [start, end] = value.map((v) =>
    typeof v === "string" ? ISO_DATE.exec(v)?.[0] : undefined,
  );
  return start && end && start <= end ? { start, end } : null;
}

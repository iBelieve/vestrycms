/**
 * Google Analytics 4, through the Data API (`runReport` and
 * `runRealtimeReport`), read as a service account: the JSON key Google
 * issues is kept in the `VESTRY_GOOGLE_ANALYTICS_CREDENTIALS` secret, and a
 * JWT signed with it (WebCrypto, so it runs in workerd) buys an hour's
 * access token. The service account needs the Viewer role on the property.
 *
 * GA4 names things differently: visitors are active users, visits are
 * sessions, and a bounce is a session that wasn't engaged (under ten
 * seconds, one page and no conversion) rather than a one-page visit.
 * "Right now" covers the last 30 minutes.
 */
import type { GoogleAnalyticsConfig } from "../../config/types.js";
import { KeyError, signJwt } from "../jwt.js";
import { base64Decode } from "../source.js";
import { addDays, PERIOD_MONTHS, previousRange, shiftMonths } from "./dates.js";
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

export const GOOGLE_CREDENTIALS = "VESTRY_GOOGLE_ANALYTICS_CREDENTIALS";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

/** How many rows each breakdown lists. */
const BREAKDOWN_LIMIT = 10;

/** How long a request may take before Google counts as unreachable. */
const REQUEST_TIMEOUT_MS = 15_000;

const TOTAL_METRICS = [
  "activeUsers",
  "sessions",
  "screenPageViews",
  "bounceRate",
  "averageSessionDuration",
];

/** The chart's buckets and the GA4 dimension for each. */
const INTERVALS: Record<
  AnalyticsPeriod,
  { interval: ProviderReport["interval"]; dimension: string }
> = {
  day: { interval: "hour", dimension: "dateHour" },
  "7d": { interval: "day", dimension: "date" },
  "30d": { interval: "day", dimension: "date" },
  "6mo": { interval: "month", dimension: "yearMonth" },
  "12mo": { interval: "month", dimension: "yearMonth" },
};

/** The fields Vestry uses from a service account's JSON key. */
interface ServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

interface DateRange {
  startDate: string;
  endDate: string;
  name?: string;
}

interface ReportRequest {
  dateRanges: DateRange[];
  metrics: string[];
  dimensions?: string[];
  orderBys?: { metric: { metricName: string }; desc: boolean }[];
  limit?: number;
}

interface ReportRow {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}

interface ReportResponse {
  rows?: ReportRow[];
  metadata?: { timeZone?: string };
}

/** Access tokens by service account, until a minute before they expire. */
const tokens = new Map<string, { token: string; expiresAt: number }>();

/** Each property's time zone, which its dates are counted in. */
const timeZones = new Map<string, string>();

export function googleAnalyticsProvider(
  config: GoogleAnalyticsConfig,
  { env, fetch, now = () => new Date() }: AnalyticsContext,
): AnalyticsProvider | { error: string } {
  const read = readServiceAccount(env(GOOGLE_CREDENTIALS));
  if ("error" in read) return read;
  const account = read;
  const propertyId = config.propertyId.trim().replace(/^properties\//, "");
  const property = `${DATA_API}/properties/${propertyId}`;
  const tokenKey = `${account.client_email}|${account.private_key_id ?? ""}`;

  async function send(url: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw new AnalyticsError(
        `Couldn't reach Google Analytics: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // A token Google no longer takes: mint a new one next time instead of
      // failing until this one's hour is up.
      if (res.status === 401) tokens.delete(tokenKey);
      throw new AnalyticsError(refusal(res.status, body, account, propertyId));
    }
    return body;
  }

  async function accessToken(): Promise<string> {
    const cached = tokens.get(tokenKey);
    if (cached && cached.expiresAt > now().getTime()) return cached.token;
    const issued = Math.floor(now().getTime() / 1000);
    let assertion: string;
    try {
      assertion = await signJwt(
        {
          iss: account.client_email,
          scope: SCOPE,
          aud: TOKEN_URL,
          iat: issued,
          exp: issued + 3600,
        },
        account.private_key,
        {
          what: `The private key in ${GOOGLE_CREDENTIALS}`,
          keyId: account.private_key_id,
        },
      );
    } catch (e) {
      if (e instanceof KeyError) throw new AnalyticsError(e.message, 500);
      throw e;
    }
    const body = (await send(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    })) as { access_token?: unknown; expires_in?: unknown } | null;
    if (typeof body?.access_token !== "string")
      throw new AnalyticsError("Google didn't answer with an access token.");
    const seconds = typeof body.expires_in === "number" ? body.expires_in : 0;
    tokens.set(tokenKey, {
      token: body.access_token,
      expiresAt: now().getTime() + (seconds - 60) * 1000,
    });
    return body.access_token;
  }

  async function call(
    method: "runReport" | "runRealtimeReport",
    request: object,
    token: string,
  ): Promise<ReportResponse> {
    const body = await send(`${property}:${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    // A proxy or sign-in page in between answers 200 with HTML.
    if (!body || typeof body !== "object")
      throw new AnalyticsError("Google Analytics didn't answer with a report.");
    return body;
  }

  const report = (request: ReportRequest, token: string) =>
    call("runReport", toApi(request), token);

  /** The property's time zone, asked once (any report's metadata says). */
  async function timeZone(token: string): Promise<string> {
    const known = timeZones.get(propertyId);
    if (known) return known;
    const res = await report(
      {
        dateRanges: [{ startDate: "today", endDate: "today" }],
        metrics: ["activeUsers"],
        limit: 1,
      },
      token,
    );
    const zone = validZone(res.metadata?.timeZone);
    // Without one, fall back to UTC for now, and ask again next time.
    if (!zone) return "UTC";
    timeZones.set(propertyId, zone);
    return zone;
  }

  /** Active users in the last 30 minutes; null if Google won't say. */
  async function current(token: string): Promise<number | null> {
    try {
      const res = await call(
        "runRealtimeReport",
        { metrics: [{ name: "activeUsers" }] },
        token,
      );
      return metric(res.rows?.[0], 0) ?? 0;
    } catch {
      return null;
    }
  }

  async function totalsWithPrevious(
    range: DateRange,
    before: DateRange | null,
    token: string,
  ) {
    const res = await report(
      {
        dateRanges: before
          ? [
              { ...range, name: "current" },
              { ...before, name: "previous" },
            ]
          : [range],
        metrics: TOTAL_METRICS,
      },
      token,
    );
    const rows = res.rows ?? [];
    // With two ranges, each row names its range in a `dateRange` column.
    const row = (name: string) =>
      rows.find((r) => r.dimensionValues?.[0]?.value === name);
    return before
      ? { totals: totals(row("current")), previous: totals(row("previous")) }
      : { totals: totals(rows[0]), previous: null };
  }

  async function series(
    period: AnalyticsPeriod,
    range: DateRange,
    hour: string,
    token: string,
  ) {
    const { interval, dimension } = INTERVALS[period];
    const res = await report(
      {
        dateRanges: [range],
        metrics: ["activeUsers", "screenPageViews"],
        dimensions: [dimension],
      },
      token,
    );
    const byTime = new Map(
      (res.rows ?? []).map((r) => [
        bucketTime(r.dimensionValues?.[0]?.value ?? ""),
        { visitors: metric(r, 0) ?? 0, pageviews: metric(r, 1) ?? 0 },
      ]),
    );
    return {
      interval,
      series: buckets(interval, range, hour).map((time): AnalyticsPoint => ({
        time,
        ...(byTime.get(time) ?? { visitors: 0, pageviews: 0 }),
      })),
    };
  }

  const breakdown =
    (
      dimension: string,
      rename: (name: string) => string = (name) => name,
      metrics = ["activeUsers"],
    ) =>
    async (range: DateRange, token: string): Promise<AnalyticsRow[]> => {
      const res = await report(
        {
          dateRanges: [range],
          metrics,
          dimensions: [dimension],
          orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
          limit: BREAKDOWN_LIMIT,
        },
        token,
      );
      return (res.rows ?? []).map((r) => {
        const row: AnalyticsRow = {
          name: rename(r.dimensionValues?.[0]?.value ?? ""),
          visitors: metric(r, 0) ?? 0,
        };
        if (metrics.length > 1) row.pageviews = metric(r, 1) ?? 0;
        return row;
      });
    };
  const pages = breakdown("pagePath", undefined, [
    "activeUsers",
    "screenPageViews",
  ]);
  const sources = breakdown("sessionSource", sourceName);
  const countries = breakdown("country");
  const devices = breakdown("deviceCategory", capitalize);

  return {
    dashboardUrl: `https://analytics.google.com/analytics/web/#/p${propertyId}/reports/intelligenthome`,
    async report(period) {
      const token = await accessToken();
      const { date, hour } = zonedNow(now(), await timeZone(token));
      const { range, before } = periodRanges(period, date);
      const [summary, chart, p, s, c, d, live] = await Promise.all([
        totalsWithPrevious(range, before, token),
        series(period, range, hour, token),
        pages(range, token),
        sources(range, token),
        countries(range, token),
        devices(range, token),
        current(token),
      ]);
      return {
        ...summary,
        ...chart,
        range: { start: range.startDate, end: range.endDate },
        pages: p,
        sources: s,
        countries: c,
        devices: d,
        current: live,
      };
    },
  };
}

/** The service account in the secret: its JSON key, or that base64-encoded. */
function readServiceAccount(
  value: string | undefined,
): ServiceAccount | { error: string } {
  const missing = `Missing environment variable: ${GOOGLE_CREDENTIALS} (a Google service account's JSON key).`;
  const text = value?.trim();
  if (!text) return { error: missing };
  let parsed: unknown;
  try {
    parsed = parseKey(
      text.startsWith("{")
        ? text
        : new TextDecoder().decode(base64Decode(text)),
    );
  } catch {
    parsed = null;
  }
  const account = parsed as Partial<ServiceAccount> | null;
  if (
    typeof account?.client_email !== "string" ||
    typeof account.private_key !== "string"
  )
    return {
      error: `${GOOGLE_CREDENTIALS} must be a service account's JSON key, with client_email and private_key.`,
    };
  return {
    client_email: account.client_email,
    private_key: account.private_key,
    private_key_id:
      typeof account.private_key_id === "string"
        ? account.private_key_id
        : undefined,
  };
}

/**
 * A JSON key. A double-quoted `.env` value has had the `\n` escapes in its
 * private key turned into line breaks, which JSON doesn't allow in a string.
 */
function parseKey(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return JSON.parse(json.replace(/\r?\n/g, "\\n"));
  }
}

/** What Google said when it refused a request, as a sentence. */
function refusal(
  status: number,
  body: unknown,
  account: ServiceAccount,
  propertyId: string,
): string {
  const error = (body as { error?: unknown } | null)?.error;
  // The Data API answers `{ error: { message, status } }`; the token
  // endpoint `{ error, error_description }`.
  const detail = (
    typeof error === "object" && error !== null
      ? String((error as { message?: unknown }).message ?? "")
      : String(
          (body as { error_description?: unknown } | null)?.error_description ??
            error ??
            "",
        )
  )
    .trim()
    .slice(0, 300);
  const reason =
    typeof error === "object" && error !== null
      ? (error as { status?: unknown }).status
      : error;
  if (reason === "PERMISSION_DENIED" && /sufficient permissions/i.test(detail))
    return `Google Analytics refused ${account.client_email} access to property ${propertyId}. Add it as a Viewer under Admin › Property access management. ${detail}`;
  if (reason === "invalid_grant" || reason === "invalid_client")
    return `Google refused the service account key in ${GOOGLE_CREDENTIALS} (${detail || reason}). Check that the key hasn't been deleted.`;
  return `Google Analytics answered HTTP ${status}${detail ? `: ${detail}` : "."}`;
}

/** A report request in the Data API's shape. */
function toApi({ metrics, dimensions, orderBys, ...rest }: ReportRequest) {
  return {
    ...rest,
    metrics: metrics.map((name) => ({ name })),
    ...(dimensions && { dimensions: dimensions.map((name) => ({ name })) }),
    ...(orderBys && { orderBys }),
  };
}

/** A row's `i`th metric as a number; GA4 sends them as strings. */
function metric(row: ReportRow | undefined, i: number): number | null {
  const value = row?.metricValues?.[i]?.value;
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function totals(row: ReportRow | undefined): AnalyticsTotals {
  const bounce = metric(row, 3);
  return {
    visitors: metric(row, 0) ?? 0,
    visits: metric(row, 1) ?? 0,
    pageviews: metric(row, 2) ?? 0,
    // GA4 gives a fraction; the report has a percentage (to a tenth).
    bounceRate: bounce === null || !row ? null : Math.round(bounce * 1000) / 10,
    visitDuration: row ? metric(row, 4) : null,
  };
}

const sourceName = (name: string) =>
  name === "(direct)" ? "Direct / None" : name;

const capitalize = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1);

function validZone(zone: string | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** Today's date and the hour (`14`) on the property's clock. */
export function zonedNow(
  now: Date,
  timeZone: string,
): { date: string; hour: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parts.hour,
  };
}

/**
 * The days a period covers, as Plausible counts them, and the stretch
 * before to compare with: today; the 7 or 30 days before today; or this
 * month and the 5 or 11 before it, so far (compared with the same months a
 * period earlier, up to the same day).
 */
export function periodRanges(
  period: AnalyticsPeriod,
  today: string,
): { range: DateRange; before: DateRange | null } {
  const months = PERIOD_MONTHS[period];
  if (months) {
    const start = `${shiftMonths(today, 1 - months).slice(0, 7)}-01`;
    // Compared as Plausible's months, which run to the end of this one, are:
    // up to the same day, or to the month's end on its last day.
    const monthEnd = addDays(shiftMonths(`${today.slice(0, 7)}-01`, 1), -1);
    const [startDate, endDate] = previousRange(
      period,
      { start, end: monthEnd },
      today,
    )!;
    return {
      range: { startDate: start, endDate: today },
      before: { startDate, endDate },
    };
  }
  if (period === "day")
    return { range: { startDate: today, endDate: today }, before: null };
  const days = period === "7d" ? 7 : 30;
  const range = {
    startDate: addDays(today, -days),
    endDate: addDays(today, -1),
  };
  const before = previousRange(period, {
    start: range.startDate,
    end: range.endDate,
  });
  return {
    range,
    before: before && { startDate: before[0], endDate: before[1] },
  };
}

/** A GA4 time dimension (`2026112014`, `20261120`, `202611`) as a bucket. */
function bucketTime(value: string): string {
  const [y, m, d = "01", h] = [
    value.slice(0, 4),
    value.slice(4, 6),
    value.slice(6, 8) || undefined,
    value.slice(8, 10) || undefined,
  ];
  return h ? `${y}-${m}-${d} ${h}:00:00` : `${y}-${m}-${d}`;
}

/** Every bucket of the range, up to the current hour for today. */
function buckets(
  interval: ProviderReport["interval"],
  range: DateRange,
  hour: string,
): string[] {
  const out: string[] = [];
  if (interval === "hour") {
    for (let h = 0; h <= Number(hour); h++)
      out.push(`${range.startDate} ${String(h).padStart(2, "0")}:00:00`);
    return out;
  }
  const step = interval === "day" ? (t: string) => addDays(t, 1) : nextMonth;
  let t =
    interval === "day" ? range.startDate : `${range.startDate.slice(0, 7)}-01`;
  while (t <= range.endDate) {
    out.push(t);
    t = step(t);
  }
  return out;
}

const nextMonth = (date: string) => shiftMonths(date, 1);

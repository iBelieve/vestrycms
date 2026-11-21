/** Formatting for the Analytics page and the dashboard's visitors card. */
import type {
  AnalyticsPeriod,
  AnalyticsReport,
  AnalyticsTotals,
} from "../../core/analytics/types.js";

export const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  day: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "6mo": "Last 6 months",
  "12mo": "Last 12 months",
};

/** The period before this one, as the comparison names it. */
export const PREVIOUS_LABELS: Record<AnalyticsPeriod, string> = {
  day: "yesterday",
  "7d": "the 7 days before",
  "30d": "the 30 days before",
  "6mo": "the 6 months before",
  "12mo": "the 12 months before",
};

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const whole = new Intl.NumberFormat("en-US");

/** 1234 → "1.2K"; small numbers stay whole. */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return n < 10_000 ? whole.format(Math.round(n)) : compact.format(n);
}

/** Exact, with thousands separators, for tooltips. */
export function formatExact(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : whole.format(Math.round(n));
}

/** Seconds as "1m 05s" (or "45s"). */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "–";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function formatPercent(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : `${Math.round(n)}%`;
}

export type TotalKey = keyof AnalyticsTotals;

/** Whether a bigger number is good news (a lower bounce rate is better). */
const HIGHER_IS_BETTER: Record<TotalKey, boolean> = {
  visitors: true,
  visits: true,
  pageviews: true,
  bounceRate: false,
  visitDuration: true,
};

export interface Change {
  /** Rounded percentage change; for bounce rate, the difference in points. */
  value: number;
  /** "up", "down" or "same", with `good` saying how to read it. */
  direction: "up" | "down" | "same";
  good: boolean | null;
  label: string;
}

/** How a total moved since the previous period, or null if it can't be said. */
export function change(
  key: TotalKey,
  now: number | null,
  before: number | null | undefined,
): Change | null {
  if (now === null || before === null || before === undefined) return null;
  // Bounce rate is already a percentage: compare points, not percent of it.
  const points = key === "bounceRate";
  if (!points && before === 0) return null;
  const value = Math.round(
    points ? now - before : ((now - before) / before) * 100,
  );
  const direction = value > 0 ? "up" : value < 0 ? "down" : "same";
  const good =
    direction === "same"
      ? null
      : (direction === "up") === HIGHER_IS_BETTER[key];
  const unit = points ? " pts" : "%";
  const label = `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value)}${unit}`;
  return { value, direction, good, label };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** A chart bucket's label: "2 PM", "Nov 20" or "Nov 2026". */
export function bucketLabel(
  time: string,
  interval: AnalyticsReport["interval"],
  long = false,
): string {
  const [date, clock = ""] = time.split(/[ T]/);
  const [y, mo, d] = date.split("-").map(Number);
  const month = MONTHS[(mo || 1) - 1];
  if (interval === "hour") {
    const h = Number(clock.slice(0, 2)) || 0;
    const hour = `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
    return long ? `${month} ${d}, ${hour}` : hour;
  }
  if (interval === "month") return long ? `${month} ${y}` : month;
  return `${month} ${d}`;
}

/** "Nov 14 – Nov 20, 2026", from a report's range. */
export function rangeLabel(range: AnalyticsReport["range"]): string | null {
  if (!range) return null;
  const year = range.end.slice(0, 4);
  const day = (iso: string) => bucketLabel(iso, "day");
  if (range.start === range.end) return `${day(range.end)}, ${year}`;
  const sameYear = range.start.slice(0, 4) === year;
  return `${day(range.start)}${sameYear ? "" : `, ${range.start.slice(0, 4)}`} – ${day(range.end)}, ${year}`;
}

/**
 * Indexes into a series to label, at most `count`, evenly spaced: every
 * n-th bucket from the first, so the gaps match.
 */
export function tickIndexes(length: number, count: number): number[] {
  if (length <= 0) return [];
  const stride = Math.max(1, Math.ceil((length - 1) / Math.max(1, count - 1)));
  const out: number[] = [];
  for (let i = 0; i < length; i += stride) out.push(i);
  return out;
}

/**
 * A round axis maximum at or above `max`, and its gridline values. The
 * values are counts, so steps are whole numbers: a 0.25 or 2.5 step would
 * label its gridlines with rounded, repeated numbers ("0, 0, 1, 1, 1").
 */
export function niceScale(max: number, lines = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / lines;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((m) => m * magnitude)
      .find((s) => s >= raw && Number.isInteger(s)) ?? Math.ceil(raw);
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(v);
  return out;
}

/** Each provider's name, for "Open in …" links. */
export const PROVIDER_LABELS: Record<AnalyticsReport["provider"], string> = {
  plausible: "Plausible",
  "google-analytics": "Google Analytics",
};

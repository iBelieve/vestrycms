/**
 * Calendar arithmetic on ISO dates (`2026-11-20`), shared by the providers:
 * the stretch a period covers and the one before it to compare with.
 */
import type { AnalyticsPeriod } from "./types.js";

/** The periods counted in calendar months, and how many. */
export const PERIOD_MONTHS: Partial<Record<AnalyticsPeriod, number>> = {
  "6mo": 6,
  "12mo": 12,
};

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** An ISO date `days` days away. */
export const addDays = (date: string, days: number) =>
  isoDay(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);

/** An ISO date `months` months away, on the same day or the month's last. */
export function shiftMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const first = Date.UTC(y, m - 1 + months, 1);
  const length = new Date(Date.UTC(y, m + months, 0)).getUTCDate();
  return isoDay(first + (Math.min(d, length) - 1) * DAY_MS);
}

/**
 * The stretch just before `range` to compare with: as many days, or for
 * the month periods as many calendar months. None for today, which is
 * still under way: a whole yesterday would always look better. Plausible's
 * months run to the end of this one, so a range that ends after `today`
 * (the site's date) is compared only up to the same point: the days still
 * to come would otherwise count against it.
 */
export function previousRange(
  period: AnalyticsPeriod,
  range: { start: string; end: string } | null,
  today?: string | null,
): [string, string] | null {
  if (period === "day" || !range) return null;
  // The last day with numbers so far, when the range runs past it.
  const sofar =
    today && today >= range.start && today < range.end ? today : null;
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const months = PERIOD_MONTHS[period];
  if (months)
    return [
      shiftMonths(range.start, -months),
      sofar ? shiftMonths(sofar, -months) : isoDay(start - DAY_MS),
    ];
  const end = Date.parse(`${sofar ?? range.end}T00:00:00Z`);
  const days = Math.round((end - start) / DAY_MS) + 1;
  return [isoDay(start - days * DAY_MS), isoDay(start - DAY_MS)];
}

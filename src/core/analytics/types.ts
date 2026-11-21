/**
 * The provider-neutral analytics report, which the Analytics page and the
 * dashboard draw, and what a provider implements to fill it in.
 */
import type { AnalyticsConfig } from "../../config/types.js";

/** The periods a report covers, as the panel offers them. */
export const ANALYTICS_PERIODS = ["day", "7d", "30d", "6mo", "12mo"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const isAnalyticsPeriod = (value: unknown): value is AnalyticsPeriod =>
  ANALYTICS_PERIODS.includes(value as AnalyticsPeriod);

/** How long a report is reused before the provider is asked again. */
export const ANALYTICS_CACHE_SECONDS = 300;

/** A period's headline numbers. `null` when the provider has none. */
export interface AnalyticsTotals {
  visitors: number | null;
  visits: number | null;
  pageviews: number | null;
  /**
   * Percentage of visits that bounced: saw one page (Plausible), or weren't
   * engaged (Google Analytics).
   */
  bounceRate: number | null;
  /** Average visit length, in seconds. */
  visitDuration: number | null;
}

/** One bucket of the chart: an hour, a day or a month. */
export interface AnalyticsPoint {
  /** ISO date (`2026-11-20`), or date and hour (`2026-11-20 14:00:00`). */
  time: string;
  visitors: number;
  pageviews: number;
}

/** A row of a breakdown: a page, a source, a country or a device. */
export interface AnalyticsRow {
  name: string;
  visitors: number;
  pageviews?: number;
}

export interface AnalyticsReport {
  available: true;
  provider: AnalyticsConfig["provider"];
  period: AnalyticsPeriod;
  /** First and last day covered (ISO dates, the site's time zone). */
  range: { start: string; end: string } | null;
  totals: AnalyticsTotals;
  /** The same numbers for the period just before, to compare with. */
  previous: AnalyticsTotals | null;
  /** People on the site in the last few minutes. */
  current: number | null;
  interval: "hour" | "day" | "month";
  series: AnalyticsPoint[];
  pages: AnalyticsRow[];
  sources: AnalyticsRow[];
  countries: AnalyticsRow[];
  devices: AnalyticsRow[];
  /** The provider's own dashboard for the site. */
  dashboardUrl: string | null;
  /** When the provider was asked (ISO time). */
  generatedAt: string;
}

/** Why there is no report: not configured, or a secret is missing. */
export type AnalyticsUnavailable = {
  available: false;
  reason: "disabled" | "setup";
  message?: string;
};

export type AnalyticsStatus = AnalyticsReport | AnalyticsUnavailable;

/** What a provider fills in; the rest of the report is common. */
export type ProviderReport = Omit<
  AnalyticsReport,
  "available" | "provider" | "period" | "dashboardUrl" | "generatedAt"
>;

export interface AnalyticsProvider {
  report(period: AnalyticsPeriod): Promise<ProviderReport>;
  dashboardUrl: string | null;
}

/** The provider could not be reached or refused the request. */
export class AnalyticsError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
    this.name = "AnalyticsError";
  }
}

export interface AnalyticsContext {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
  /** The current time (tests fix it). */
  now?: () => Date;
}

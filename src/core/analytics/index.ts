/**
 * Site analytics: visitor numbers from the provider the config names, in
 * one provider-neutral report (`types.ts`).
 *
 * A provider turns a period into a report; adding one means a variant of
 * `AnalyticsConfig`, a factory in `PROVIDERS` and its own module (see
 * `plausible.ts`). Reports are cached for a few minutes, because each one
 * takes several requests and providers limit them (Plausible allows 600 an
 * hour per key).
 */
import type { AnalyticsConfig, VestryConfig } from "../../config/types.js";
import type { Cache } from "../cache.js";
import { plausibleProvider } from "./plausible.js";
import {
  ANALYTICS_CACHE_SECONDS,
  type AnalyticsContext,
  type AnalyticsPeriod,
  type AnalyticsProvider,
  type AnalyticsReport,
  type AnalyticsStatus,
  type AnalyticsUnavailable,
} from "./types.js";

export * from "./types.js";

type ProviderFactory<C extends AnalyticsConfig> = (
  config: C,
  context: AnalyticsContext,
) => AnalyticsProvider | { error: string };

const PROVIDERS: {
  [P in AnalyticsConfig["provider"]]: ProviderFactory<
    Extract<AnalyticsConfig, { provider: P }>
  >;
} = {
  plausible: plausibleProvider,
};

/** The configured provider, or why there is none. */
function analyticsProvider(
  config: VestryConfig,
  context: AnalyticsContext,
): AnalyticsProvider | AnalyticsUnavailable {
  const settings = config.analytics;
  if (!settings) return { available: false, reason: "disabled" };
  const provider = PROVIDERS[settings.provider](settings, context);
  if ("error" in provider)
    return { available: false, reason: "setup", message: provider.error };
  return provider;
}

/** The report for `period`, from the cache when it is recent. */
export async function analyticsReport(
  config: VestryConfig,
  period: AnalyticsPeriod,
  context: AnalyticsContext & { cache: Cache },
): Promise<AnalyticsStatus> {
  const provider = analyticsProvider(config, context);
  if ("available" in provider) return provider;
  const settings = config.analytics!;
  const key = `analytics:${settings.provider}:${settings.siteId}:${period}`;
  const cached = await context.cache.get<AnalyticsReport>(key);
  if (cached) return cached;
  const report: AnalyticsReport = {
    available: true,
    provider: settings.provider,
    period,
    ...(await provider.report(period)),
    dashboardUrl: provider.dashboardUrl,
    generatedAt: (context.now?.() ?? new Date()).toISOString(),
  };
  await context.cache.set(key, report, ANALYTICS_CACHE_SECONDS);
  return report;
}

import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import type { AnalyticsReport } from "../../core/analytics/types.js";
import { useVestry } from "../context.js";
import { formatExact } from "../lib/analytics.js";
import {
  AnalyticsStat,
  AnalyticsUnavailableNote,
  Breakdown,
  sitePageUrl,
  useAnalytics,
} from "./Analytics.js";
import { AnalyticsChart } from "./AnalyticsChart.js";
import { Alert, Spinner } from "./ui.js";
import { describeError } from "../api.js";

/** How many top pages the dashboard lists. */
const TOP_PAGES = 5;

/**
 * The dashboard's visitors card: the last 7 days at a glance, linking to
 * the Analytics page. Renders nothing when the site has no analytics.
 */
export function AnalyticsWidget() {
  const { config } = useVestry();
  const query = useAnalytics("7d", Boolean(config.analytics));
  if (!config.analytics) return null;
  return (
    <section className="v-section">
      <h2 className="v-section-title v-analytics-widget__title">
        Visitors, last 7 days
        <Link to="/analytics" className="v-analytics-widget__more">
          Analytics <ArrowRight size={12} />
        </Link>
      </h2>
      {query.isLoading ? (
        <div className="v-card v-analytics-widget__loading">
          <Spinner /> Loading visitors…
        </div>
      ) : query.error ? (
        <Alert kind="warning">
          {`Couldn't load analytics: ${describeError(query.error).message}`}
        </Alert>
      ) : query.data?.available ? (
        <WidgetReport report={query.data} />
      ) : (
        query.data && <AnalyticsUnavailableNote status={query.data} />
      )}
    </section>
  );
}

function WidgetReport({ report }: { report: AnalyticsReport }) {
  const { config } = useVestry();
  return (
    <div className="v-analytics-widget">
      <div className="v-card v-analytics-widget__summary">
        <div className="v-astats v-astats--compact">
          <AnalyticsStat report={report} stat="visitors" />
          <AnalyticsStat report={report} stat="pageviews" />
          {report.current !== null && (
            <div className="v-astat">
              <span className="v-astat__label">Right now</span>
              <span className="v-astat__value">
                {formatExact(report.current)}
              </span>
              <span className="v-analytics__live">
                <span className="v-analytics__pulse" />
                {report.current === 1 ? "visitor" : "visitors"}
              </span>
            </div>
          )}
        </div>
        <AnalyticsChart report={report} height={120} />
      </div>
      <Breakdown
        title="Top pages"
        rows={report.pages.slice(0, TOP_PAGES)}
        href={(row) => sitePageUrl(config.siteUrl, row.name)}
      />
    </div>
  );
}

import { ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Navigate } from "react-router";
import {
  ANALYTICS_PERIODS,
  type AnalyticsPeriod,
  type AnalyticsReport,
} from "../../core/analytics/types.js";
import {
  AnalyticsStat,
  AnalyticsUnavailableNote,
  Breakdown,
  sitePageUrl,
  useAnalytics,
} from "../components/Analytics.js";
import {
  AnalyticsChart,
  type ChartMetric,
} from "../components/AnalyticsChart.js";
import { TopBar } from "../components/Layout.js";
import { ErrorState, Loading } from "../components/ui.js";
import { useVestry } from "../context.js";
import {
  formatExact,
  PERIOD_LABELS,
  PROVIDER_LABELS,
  rangeLabel,
  type TotalKey,
} from "../lib/analytics.js";

const PERIOD_KEY = "vestry:analytics-period";

function savedPeriod(): AnalyticsPeriod {
  try {
    const saved = localStorage.getItem(PERIOD_KEY);
    return (ANALYTICS_PERIODS as readonly string[]).includes(saved ?? "")
      ? (saved as AnalyticsPeriod)
      : "30d";
  } catch {
    return "30d";
  }
}

export function AnalyticsPage() {
  const { config } = useVestry();
  const [period, setPeriod] = useState<AnalyticsPeriod>(savedPeriod);
  const query = useAnalytics(period, Boolean(config.analytics));
  if (!config.analytics) return <Navigate to="/" replace />;

  const choose = (p: AnalyticsPeriod) => {
    setPeriod(p);
    try {
      localStorage.setItem(PERIOD_KEY, p);
    } catch {
      // A private window: the choice just isn't remembered.
    }
  };
  const report = query.data?.available ? query.data : null;
  const picker = <PeriodPicker period={period} onChange={choose} />;

  return (
    <>
      <TopBar
        title="Analytics"
        crumbs={[{ label: "Analytics" }]}
        actions={
          report?.dashboardUrl && (
            <a
              className="v-btn"
              href={report.dashboardUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink /> Open in {PROVIDER_LABELS[report.provider]}
            </a>
          )
        }
      />
      <div className="v-page">
        {!report && <div className="v-analytics__toolbar">{picker}</div>}
        {/* A report already shown stays when a later refresh fails. */}
        {query.isLoading ? (
          <Loading label="Loading analytics…" />
        ) : report ? (
          <AnalyticsReportView report={report} toolbar={picker} />
        ) : query.error ? (
          <ErrorState
            title="Analytics couldn't load"
            error={query.error}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        ) : (
          query.data && <AnalyticsUnavailableNote status={query.data} />
        )}
      </div>
    </>
  );
}

function PeriodPicker({
  period,
  onChange,
}: {
  period: AnalyticsPeriod;
  onChange: (period: AnalyticsPeriod) => void;
}) {
  return (
    <div
      className="v-segment v-analytics__periods"
      role="group"
      aria-label="Period"
    >
      {ANALYTICS_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          className={p === period ? "is-active" : undefined}
          aria-pressed={p === period}
          onClick={() => onChange(p)}
        >
          {PERIOD_LABELS[p].replace("Last ", "")}
        </button>
      ))}
    </div>
  );
}

const PAGE_STATS: TotalKey[] = [
  "visitors",
  "visits",
  "pageviews",
  "bounceRate",
  "visitDuration",
];

function AnalyticsReportView({
  report,
  toolbar,
}: {
  report: AnalyticsReport;
  toolbar: ReactNode;
}) {
  const { config } = useVestry();
  const [metric, setMetric] = useState<ChartMetric>("visitors");
  const range = rangeLabel(report.range);
  return (
    <>
      <div className="v-analytics__toolbar">
        <p className="v-analytics__meta">
          {PERIOD_LABELS[report.period]}
          {range && ` · ${range}`}
          {report.current !== null && (
            <span className="v-analytics__live">
              <span className="v-analytics__pulse" />
              {formatExact(report.current)}{" "}
              {report.current === 1 ? "visitor" : "visitors"} right now
            </span>
          )}
        </p>
        {toolbar}
      </div>
      <section className="v-card v-analytics__overview">
        <div className="v-astats">
          {PAGE_STATS.map((stat) => (
            <AnalyticsStat
              key={stat}
              report={report}
              stat={stat}
              active={stat === metric}
              onSelect={
                stat === "visitors" || stat === "pageviews"
                  ? () => setMetric(stat)
                  : undefined
              }
            />
          ))}
        </div>
        <AnalyticsChart report={report} metric={metric} height={260} />
      </section>
      <div className="v-analytics__grid">
        <Breakdown
          title="Top pages"
          rows={report.pages}
          href={(row) => sitePageUrl(config.siteUrl, row.name)}
        />
        <Breakdown
          title="Top sources"
          rows={report.sources}
          empty="No visits from other sites yet."
        />
        <Breakdown title="Countries" rows={report.countries} />
        <Breakdown title="Devices" rows={report.devices} />
      </div>
    </>
  );
}

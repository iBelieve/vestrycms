import { useEffect, useRef, useState } from "react";
import type { AnalyticsReport } from "../../core/analytics/types.js";
import {
  bucketLabel,
  formatCount,
  formatExact,
  niceScale,
  tickIndexes,
} from "../lib/analytics.js";

export type ChartMetric = "visitors" | "pageviews";

const METRIC_LABELS: Record<ChartMetric, string> = {
  visitors: "Visitors",
  pageviews: "Pageviews",
};

const PAD = { top: 12, right: 12, bottom: 26, left: 40 };

/** The element's width, following resizes (a fallback before layout and in tests). */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth) setWidth(el.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Visitors (or pageviews) over the report's period: one series, so no
 * legend; hover shows each bucket's exact number.
 */
export function AnalyticsChart({
  report,
  metric = "visitors",
  height = 220,
  compact = false,
}: {
  report: AnalyticsReport;
  metric?: ChartMetric;
  height?: number;
  /** A sparkline: no axes or gridlines. */
  compact?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = useState<number | null>(null);
  const series = report.series;
  const pad = compact ? { top: 4, right: 4, bottom: 4, left: 4 } : PAD;
  const values = series.map((p) => p[metric]);
  const grid = niceScale(Math.max(0, ...values));
  const top = grid[grid.length - 1] || 1;
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);
  const x = (i: number) =>
    pad.left + (series.length > 1 ? (i / (series.length - 1)) * innerW : 0);
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const line = values
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const base = y(0).toFixed(1);
  const area = series.length
    ? `${line} L${x(series.length - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`
    : "";
  const slot = series.length > 1 ? innerW / (series.length - 1) : innerW;
  const point = hover === null ? null : series[hover];

  return (
    <div
      ref={ref}
      className="v-chart"
      style={{ height }}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${METRIC_LABELS[metric]} over time`}
      >
        {!compact &&
          grid.map((v) => (
            <g key={v}>
              <line
                className="v-chart__grid"
                x1={pad.left}
                x2={width - pad.right}
                y1={y(v)}
                y2={y(v)}
              />
              <text
                className="v-chart__axis"
                x={pad.left - 8}
                y={y(v)}
                dy="0.32em"
                textAnchor="end"
              >
                {formatCount(v)}
              </text>
            </g>
          ))}
        {!compact &&
          tickIndexes(series.length, Math.max(2, Math.floor(innerW / 90))).map(
            (i) => (
              <text
                key={i}
                className="v-chart__axis"
                x={x(i)}
                y={height - 8}
                textAnchor={
                  i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"
                }
              >
                {bucketLabel(series[i].time, report.interval)}
              </text>
            ),
          )}
        <path className="v-chart__area" d={area} />
        <path className="v-chart__line" d={line} />
        {point && hover !== null && (
          <>
            <line
              className="v-chart__cursor"
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.top}
              y2={pad.top + innerH}
            />
            <circle
              className="v-chart__dot"
              cx={x(hover)}
              cy={y(point[metric])}
              r={4}
            />
          </>
        )}
        {series.map((p, i) => (
          <rect
            key={p.time}
            className="v-chart__hit"
            x={x(i) - slot / 2}
            y={0}
            width={slot}
            height={height}
            onMouseEnter={() => setHover(i)}
          >
            <title>{`${bucketLabel(p.time, report.interval, true)}: ${formatExact(p[metric])} ${METRIC_LABELS[metric].toLowerCase()}`}</title>
          </rect>
        ))}
      </svg>
      {point && hover !== null && (
        <div
          className="v-chart__tip"
          style={{
            left: Math.min(Math.max(x(hover), 70), width - 70),
            top: Math.max(0, y(point[metric]) - 12),
          }}
        >
          <span className="v-chart__tip-label">
            {bucketLabel(point.time, report.interval, true)}
          </span>
          <strong>{formatExact(point[metric])}</strong>{" "}
          {METRIC_LABELS[metric].toLowerCase()}
        </div>
      )}
    </div>
  );
}

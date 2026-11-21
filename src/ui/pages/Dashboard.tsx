import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, Plus } from "lucide-react";
import { Link } from "react-router";
import type { CollectionConfig } from "../../config/types.js";
import {
  recentDateField,
  type DashboardCollection,
} from "../../core/dashboard.js";
import type { EntrySummary } from "../../core/service.js";
import { isEditable } from "../../core/paths.js";
import { AnalyticsWidget } from "../components/AnalyticsWidget.js";
import { TopBar } from "../components/Layout.js";
import { Icon } from "../components/Icon.js";
import { Badge } from "../components/ui.js";
import { useVestry } from "../context.js";
import { entryHref, formatDate, inSentence } from "../lib/utils.js";

export function DashboardPage() {
  const { config, api, client } = useVestry();
  const collections = Object.entries(config.collections ?? {});
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.dashboard(),
    staleTime: 30_000,
  });
  const summaries = query.data?.collections ?? {};

  return (
    <>
      <TopBar title="Dashboard" />
      <div className="v-page">
        <AnalyticsWidget />
        {collections.length > 0 && (
          <section className="v-section">
            <h2 className="v-section-title">Collections</h2>
            <div className="v-stats">
              {collections.map(([key, col]) => (
                <Link
                  key={key}
                  to={`/collections/${key}`}
                  className="v-card v-stat"
                >
                  <span className="v-stat__icon">
                    <Icon name={col.icon ?? "files"} />
                  </span>
                  <span className="v-stat__body">
                    <span className="v-stat__label">{col.label}</span>
                    <span
                      className="v-stat__meta"
                      title={statError(summaries[key], query.error)}
                    >
                      {statMeta(summaries[key], query.isError)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
        {collections.map(([key, col]) => {
          const summary = summaries[key];
          const recent = summary && "recent" in summary ? summary.recent : [];
          if (!recent.length) return null;
          return (
            <RecentSection
              key={key}
              collectionKey={key}
              col={col}
              entries={recent}
            />
          );
        })}
        {client.mode === "local" && (
          <p className="v-muted" style={{ marginTop: 28, fontSize: 12.5 }}>
            Local mode: changes are written straight to your working copy.
            Commit them with git when you're happy.
          </p>
        )}
      </div>
    </>
  );
}

/** A collection tile's second line: its entry and draft counts. */
function statMeta(
  summary: DashboardCollection | undefined,
  failed: boolean,
): string {
  if (!summary) return failed ? "Couldn't load" : "…";
  if ("error" in summary) return "Couldn't load";
  const { count, drafts } = summary;
  const entries = `${count} ${count === 1 ? "entry" : "entries"}`;
  return drafts > 0
    ? `${entries} · ${drafts} draft${drafts === 1 ? "" : "s"}`
    : entries;
}

/** Why a collection tile says "Couldn't load", shown when hovering it. */
function statError(
  summary: DashboardCollection | undefined,
  error: Error | null,
): string | undefined {
  if (summary && "error" in summary) return summary.error;
  return summary ? undefined : error?.message;
}

/** A collection's latest entries, with a button to start a new one. */
function RecentSection({
  collectionKey: key,
  col,
  entries,
}: {
  collectionKey: string;
  col: CollectionConfig;
  entries: EntrySummary[];
}) {
  const dateField = recentDateField(col);
  return (
    <section className="v-section">
      <div className="v-section-head">
        <h2 className="v-section-title">Recent {inSentence(col.label)}</h2>
        {isEditable(col) && (
          <Link
            to={`/collections/${key}/new`}
            className="v-btn v-btn--sm v-btn--ghost"
          >
            <Plus /> New {inSentence(col.singular ?? "entry")}
          </Link>
        )}
      </div>
      <div className="v-card">
        <table className="v-table">
          <tbody>
            {entries.map((e) => (
              <tr key={e.slug}>
                <td className="v-table__main">
                  <Link className="v-table__title" to={entryHref(key, e.slug)}>
                    {e.title}
                  </Link>
                  {e.excerpt && (
                    <span className="v-table__sub">{e.excerpt}</span>
                  )}
                </td>
                {dateField && (
                  <td className="v-muted" style={{ whiteSpace: "nowrap" }}>
                    <Clock
                      size={13}
                      style={{ verticalAlign: -2, marginRight: 6 }}
                    />
                    {formatDate(e.data[dateField])}
                  </td>
                )}
                <td style={{ width: 1 }}>
                  {e.status && <Badge status={e.status} />}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="v-table__more">
                <Link to={`/collections/${key}`}>
                  All {inSentence(col.label)}{" "}
                  <ArrowRight size={12} style={{ verticalAlign: -1 }} />
                </Link>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

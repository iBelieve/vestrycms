import { useQueries } from "@tanstack/react-query";
import { ArrowRight, Clock, Plus } from "lucide-react";
import { Link } from "react-router";
import type { CollectionConfig } from "../../config/types.js";
import type { EntrySummary } from "../../core/service.js";
import { isEditable } from "../../core/paths.js";
import { AnalyticsWidget } from "../components/AnalyticsWidget.js";
import { TopBar } from "../components/Layout.js";
import { Icon } from "../components/Icon.js";
import { Badge } from "../components/ui.js";
import { useVestry } from "../context.js";
import { entryHref, formatDate, inSentence } from "../lib/utils.js";

const DEFAULT_RECENT = 5;

function isDateField(col: CollectionConfig, field: string | undefined) {
  const type = field ? col.schema[field]?.type : undefined;
  return type === "date" || type === "datetime";
}

/** The date field the default `recent` rule keys on: a date `sort`. */
function sortDateField(col: CollectionConfig): string | null {
  const field = col.sort?.field;
  return field && isDateField(col, field) ? field : null;
}

/**
 * Which date field (if any) a collection's recent list should show: the
 * sort field when it is a date, else the first date column of its list.
 */
function recentDateField(col: CollectionConfig): string | null {
  const column = (col.columns ?? [])
    .map((c) => (typeof c === "string" ? c : c.field))
    .find((field) => isDateField(col, field));
  return sortDateField(col) ?? column ?? null;
}

function recentCount(col: CollectionConfig): number {
  if (col.recent === false) return 0;
  if (typeof col.recent === "number") return Math.max(0, col.recent);
  if (col.recent === true) return DEFAULT_RECENT;
  return sortDateField(col) ? DEFAULT_RECENT : 0;
}

export function DashboardPage() {
  const { config, api, client } = useVestry();
  const collections = Object.entries(config.collections ?? {});
  const creatable = collections.filter(
    ([, col]) => recentCount(col) > 0 && isEditable(col),
  );
  const queries = useQueries({
    queries: collections.map(([key]) => ({
      queryKey: ["entries", key],
      queryFn: () => api.listEntries(key),
      staleTime: 30_000,
    })),
  });

  return (
    <>
      <TopBar
        title="Dashboard"
        actions={
          creatable.length > 0 && <NewEntryButtons collections={creatable} />
        }
      />
      <div className="v-page">
        <AnalyticsWidget />
        {collections.length > 0 && (
          <section className="v-section">
            <h2 className="v-section-title">Collections</h2>
            <div className="v-stats">
              {collections.map(([key, col], i) => {
                const q = queries[i];
                const count = q.data?.entries.length;
                const drafts =
                  q.data?.entries.filter((e) => e.status === "draft").length ??
                  0;
                return (
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
                      <span className="v-stat__meta">
                        {count === undefined
                          ? "…"
                          : `${count} ${count === 1 ? "entry" : "entries"}`}
                        {drafts > 0 &&
                          ` · ${drafts} draft${drafts === 1 ? "" : "s"}`}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
        {collections.map(([key, col], i) => {
          const limit = recentCount(col);
          const recent = limit
            ? (queries[i].data?.entries.slice(0, limit) ?? [])
            : [];
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

/**
 * A New button for each collection with a recent list that takes new
 * entries, for the dashboard's top bar. A collection without a `singular`
 * is named by its label, so its button can be told from the others.
 */
function NewEntryButtons({
  collections,
}: {
  collections: [string, CollectionConfig][];
}) {
  return (
    <>
      {collections.map(([key, col]) => (
        <Link
          key={key}
          to={`/collections/${key}/new`}
          className="v-btn v-btn--primary"
        >
          <Plus /> New {col.singular ?? col.label}
        </Link>
      ))}
    </>
  );
}

/** A collection's latest entries. */
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
      <h2 className="v-section-title">Recent {inSentence(col.label)}</h2>
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
                {dateField && <RecentDate value={e.data[dateField]} />}
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

/** A recent entry's date cell, empty (no clock) for an entry without one. */
function RecentDate({ value }: { value: unknown }) {
  const date = formatDate(value);
  return (
    <td className="v-muted" style={{ whiteSpace: "nowrap" }}>
      {date && (
        <Clock size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
      )}
      {date}
    </td>
  );
}

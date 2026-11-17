import { useQueries } from "@tanstack/react-query";
import { ArrowRight, Clock } from "lucide-react";
import { Link } from "react-router";
import type { CollectionConfig } from "../../config/types.js";
import { TopBar } from "../components/Layout.js";
import { Icon } from "../components/Icon.js";
import { Badge } from "../components/ui.js";
import { useVestry } from "../context.js";
import { entryHref, formatDate } from "../lib/utils.js";

const DEFAULT_RECENT = 5;

/** Which date field (if any) a collection's recent list should show. */
function recentDateField(col: CollectionConfig): string | null {
  const field = col.sort?.field;
  if (!field) return null;
  const type = col.schema[field]?.type;
  return type === "date" || type === "datetime" ? field : null;
}

function recentCount(col: CollectionConfig): number {
  if (col.recent === false) return 0;
  if (typeof col.recent === "number") return col.recent;
  if (col.recent === true) return DEFAULT_RECENT;
  return recentDateField(col) ? DEFAULT_RECENT : 0;
}

export function DashboardPage() {
  const { config, api, client } = useVestry();
  const collections = Object.entries(config.collections ?? {});
  const queries = useQueries({
    queries: collections.map(([key]) => ({
      queryKey: ["entries", key],
      queryFn: () => api.listEntries(key),
      staleTime: 30_000,
    })),
  });

  return (
    <>
      <TopBar title="Dashboard" />
      <div className="v-page">
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
          const dateField = recentDateField(col);
          return (
            <section key={key} className="v-section">
              <h2 className="v-section-title">
                Recent {col.label.toLowerCase()}
              </h2>
              <div className="v-card">
                <table className="v-table">
                  <tbody>
                    {recent.map((e) => (
                      <tr key={e.slug}>
                        <td className="v-table__main">
                          <Link
                            className="v-table__title"
                            to={entryHref(key, e.slug)}
                          >
                            {e.title}
                          </Link>
                          {e.excerpt && (
                            <span className="v-table__sub">{e.excerpt}</span>
                          )}
                        </td>
                        {dateField && (
                          <td
                            className="v-muted"
                            style={{ whiteSpace: "nowrap" }}
                          >
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
                          All {col.label.toLowerCase()}{" "}
                          <ArrowRight size={12} style={{ verticalAlign: -1 }} />
                        </Link>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
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

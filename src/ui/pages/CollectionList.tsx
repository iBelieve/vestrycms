import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { Field } from "../../config/types.js";
import { fillTemplate } from "../../core/paths.js";
import { Icon } from "../components/Icon.js";
import { TopBar } from "../components/Layout.js";
import {
  Alert,
  Badge,
  EmptyState,
  Loading,
  NotFoundState,
} from "../components/ui.js";
import type { EntrySummary } from "../../core/service.js";
import { useVestry } from "../context.js";
import { cx, fieldLabel, formatDate, titleCase } from "../lib/utils.js";

export function CollectionListPage() {
  const { collection: key = "" } = useParams();
  const { config, api } = useVestry();
  const col = config.collections?.[key];
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "published" | "draft">("all");
  const [sort, setSort] = useState<{
    field: string;
    dir: "asc" | "desc";
  } | null>(null);

  const q = useQuery({
    queryKey: ["entries", key],
    queryFn: () => api.listEntries(key),
    enabled: Boolean(col),
  });

  const columns = useMemo(() => {
    if (!col) return [];
    const list = col.columns ?? (col.sort?.field ? [col.sort.field] : []);
    return list.map((c) => (typeof c === "string" ? { field: c } : c));
  }, [col]);

  const entries = useMemo(() => {
    let list = q.data?.entries ?? [];
    if (status !== "all") list = list.filter((e) => e.status === status);
    if (search.trim()) {
      const s = search.toLowerCase();
      const fields = col?.searchFields ?? [col?.titleField ?? "title"];
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(s) ||
          e.slug.toLowerCase().includes(s) ||
          fields.some((f) =>
            String(e.data[f] ?? "")
              .toLowerCase()
              .includes(s),
          ),
      );
    }
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const av = sortValue(a, sort.field);
        const bv = sortValue(b, sort.field);
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
    return list;
  }, [q.data, status, search, sort, col]);

  if (!col) return <NotFoundState title={`No collection called “${key}”`} />;

  const toggleSort = (field: string) =>
    setSort((s) =>
      s?.field === field
        ? { field, dir: s.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "asc" },
    );

  const header = (field: string, label: string) => (
    <th key={field}>
      <button type="button" onClick={() => toggleSort(field)}>
        {label}
        {sort?.field === field &&
          (sort.dir === "asc" ? <ArrowUp /> : <ArrowDown />)}
      </button>
    </th>
  );

  return (
    <>
      <TopBar
        title={col.label}
        actions={
          col.create !== false && (
            <Link
              to={`/collections/${key}/new`}
              className="v-btn v-btn--primary"
            >
              <Plus /> New {col.singular ?? "entry"}
            </Link>
          )
        }
      />
      <div className="v-page">
        <div className="v-toolbar">
          <div className="v-search">
            <Search />
            <input
              className="v-input"
              placeholder={`Search ${col.label.toLowerCase()}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {col.status && (
            <div className="v-segment">
              {(["all", "published", "draft"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={cx(status === s && "is-active")}
                  onClick={() => setStatus(s)}
                >
                  {titleCase(s)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="v-card">
          {q.isLoading && <Loading />}
          {q.error && (
            <div style={{ padding: 18 }}>
              <Alert kind="error">{(q.error as Error).message}</Alert>
            </div>
          )}
          {q.data && entries.length === 0 && (
            <EmptyState
              icon={<Icon name={col.icon ?? "files"} />}
              title={
                search ? "No matches" : `No ${col.label.toLowerCase()} yet`
              }
            >
              {!search && col.create !== false && (
                <p>
                  <Link to={`/collections/${key}/new`} className="v-btn">
                    <Plus /> Create the first{" "}
                    {col.singular?.toLowerCase() ?? "entry"}
                  </Link>
                </p>
              )}
            </EmptyState>
          )}
          {q.data && entries.length > 0 && (
            <>
              <div className="v-table-wrap">
                <table className="v-table">
                  <thead>
                    <tr>
                      {header("title", "Title")}
                      {columns.map((c) => {
                        if (c.field === "status" || c.field === "slug")
                          return header(c.field, c.label ?? titleCase(c.field));
                        const f = col.schema[c.field];
                        return header(
                          c.field,
                          c.label ??
                            (f ? fieldLabel(c.field, f) : titleCase(c.field)),
                        );
                      })}
                      {col.status &&
                        !columns.some((c) => c.field === "status") && (
                          <th>Status</th>
                        )}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.slug}>
                        <td className="v-table__main">
                          <Link
                            className="v-table__title"
                            to={`/collections/${key}/${e.slug}`}
                          >
                            {e.title}
                          </Link>
                          {e.data[col.titleField ?? "title"] !== undefined &&
                          e.data.subtitle ? (
                            <span className="v-table__sub">
                              {String(e.data.subtitle)}
                            </span>
                          ) : (
                            e.excerpt && (
                              <span className="v-table__sub">{e.excerpt}</span>
                            )
                          )}
                        </td>
                        {columns.map((c) => (
                          <td key={c.field} style={{ whiteSpace: "nowrap" }}>
                            {c.field === "status" ? (
                              <Badge status={e.status} />
                            ) : c.field === "slug" ? (
                              <span className="v-mono">{e.slug}</span>
                            ) : (
                              <CellValue
                                field={col.schema[c.field]}
                                value={e.data[c.field]}
                              />
                            )}
                          </td>
                        ))}
                        {col.status &&
                          !columns.some((c) => c.field === "status") && (
                            <td>
                              <Badge status={e.status} />
                            </td>
                          )}
                        <td className="v-table__actions">
                          {col.previewUrl && (
                            <a
                              className="v-btn v-btn--ghost v-btn--xs v-btn--icon"
                              title="View on site"
                              target="_blank"
                              rel="noreferrer"
                              href={`${config.siteUrl ?? ""}${fillTemplate(col.previewUrl, { ...e.data, slug: e.slug })}`}
                            >
                              <ExternalLink />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="v-table__footer">
                {entries.length} of {q.data.entries.length}{" "}
                {col.label.toLowerCase()}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** What an entry is sorted by in a column. */
function sortValue(entry: EntrySummary, field: string): string {
  if (field === "title") return entry.title;
  if (field === "slug") return entry.slug;
  return String(entry.data[field] ?? "");
}

function CellValue({ field, value }: { field?: Field; value: unknown }) {
  const { api } = useVestry();
  if (value === undefined || value === null || value === "")
    return <span className="v-faint">—</span>;
  if (!field) return <>{String(value)}</>;
  switch (field.type) {
    case "date":
    case "datetime":
      return <>{formatDate(value)}</>;
    case "boolean":
      return <>{value ? "Yes" : "No"}</>;
    case "select": {
      const opt = field.options.find((o) => o.value === value);
      return (
        <span className="v-row" style={{ gap: 6 }}>
          {opt?.color && (
            <span className="v-swatch" style={{ background: opt.color }} />
          )}
          {opt?.label ?? String(value)}
        </span>
      );
    }
    case "image":
      return (
        <img
          className="v-thumb"
          src={api.fileUrl(String(value))}
          alt=""
          loading="lazy"
        />
      );
    case "reference":
      return (
        <ReferenceLabel collection={field.collection} id={String(value)} />
      );
    case "array":
      return <>{Array.isArray(value) ? `${value.length} items` : ""}</>;
    case "object":
      return <span className="v-muted">…</span>;
    default:
      return <>{String(value)}</>;
  }
}

function ReferenceLabel({
  collection,
  id,
}: {
  collection: string;
  id: string;
}) {
  const { api } = useVestry();
  const q = useQuery({
    queryKey: ["entries", collection],
    queryFn: () => api.listEntries(collection),
    staleTime: 60_000,
  });
  const e = q.data?.entries.find((x) => x.slug === id);
  return <>{e?.title ?? id}</>;
}

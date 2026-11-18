import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type {
  CollectionConfig,
  Field,
  ListColumn,
} from "../../config/types.js";
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
import {
  cx,
  entryHref,
  fieldLabel,
  formatDate,
  titleCase,
} from "../lib/utils.js";

type Status = "all" | "published" | "draft";
type Sort = { field: string; dir: "asc" | "desc" };

export function CollectionListPage() {
  const { collection: key = "" } = useParams();
  const { config, api } = useVestry();
  const col = config.collections?.[key];
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [sort, setSort] = useState<Sort | null>(null);

  const q = useQuery({
    queryKey: ["entries", key],
    queryFn: () => api.listEntries(key),
    enabled: Boolean(col),
  });

  const entries = useMemo(
    () =>
      col && q.data
        ? sortEntries(filterEntries(q.data.entries, col, status, search), sort)
        : [],
    [q.data, status, search, sort, col],
  );

  if (!col) return <NotFoundState title={`No collection called “${key}”`} />;

  const canCreate = col.create !== false;
  return (
    <>
      <TopBar
        title={col.label}
        actions={
          canCreate && (
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
          {col.status && <StatusFilter status={status} onStatus={setStatus} />}
        </div>
        <div className="v-card">
          {q.isLoading && <Loading />}
          {q.error && (
            <div style={{ padding: 18 }}>
              <Alert kind="error">{(q.error as Error).message}</Alert>
            </div>
          )}
          {q.data && entries.length === 0 && (
            <NoEntries
              col={col}
              collectionKey={key}
              searching={Boolean(search)}
            />
          )}
          {q.data && entries.length > 0 && (
            <>
              <EntryTable
                col={col}
                collectionKey={key}
                entries={entries}
                sort={sort}
                onSort={(field) => setSort((s) => nextSort(s, field))}
                siteUrl={config.siteUrl}
              />
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

/** Clicking a column sorts by it, then reverses; a new column starts ascending. */
function nextSort(sort: Sort | null, field: string): Sort {
  if (sort?.field !== field) return { field, dir: "asc" };
  return { field, dir: sort.dir === "asc" ? "desc" : "asc" };
}

/** The entries with `status` that match `search` in their title, slug or search fields. */
function filterEntries(
  entries: EntrySummary[],
  col: CollectionConfig,
  status: Status,
  search: string,
): EntrySummary[] {
  let list = entries;
  if (status !== "all") list = list.filter((e) => e.status === status);
  if (!search.trim()) return list;
  const s = search.toLowerCase();
  const fields = col.searchFields ?? [col.titleField ?? "title"];
  const matches = (v: unknown) =>
    String(v ?? "")
      .toLowerCase()
      .includes(s);
  return list.filter(
    (e) =>
      matches(e.title) ||
      matches(e.slug) ||
      fields.some((f) => matches(e.data[f])),
  );
}

function sortEntries(entries: EntrySummary[], sort: Sort | null) {
  if (!sort) return entries;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    const av = sortValue(a, sort.field);
    const bv = sortValue(b, sort.field);
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}

/** The listed columns: `columns`, or else the field the collection sorts by. */
function listColumns(col: CollectionConfig): ListColumn[] {
  const list = col.columns ?? (col.sort?.field ? [col.sort.field] : []);
  return list.map((c) => (typeof c === "string" ? { field: c } : c));
}

function columnLabel(col: CollectionConfig, c: ListColumn): string {
  if (c.label !== undefined) return c.label;
  const f =
    c.field === "status" || c.field === "slug"
      ? undefined
      : col.schema[c.field];
  return f ? fieldLabel(c.field, f) : titleCase(c.field);
}

function StatusFilter({
  status,
  onStatus,
}: {
  status: Status;
  onStatus: (status: Status) => void;
}) {
  return (
    <div className="v-segment">
      {(["all", "published", "draft"] as const).map((s) => (
        <button
          key={s}
          type="button"
          className={cx(status === s && "is-active")}
          onClick={() => onStatus(s)}
        >
          {titleCase(s)}
        </button>
      ))}
    </div>
  );
}

function NoEntries({
  col,
  collectionKey,
  searching,
}: {
  col: CollectionConfig;
  collectionKey: string;
  searching: boolean;
}) {
  return (
    <EmptyState
      icon={<Icon name={col.icon ?? "files"} />}
      title={searching ? "No matches" : `No ${col.label.toLowerCase()} yet`}
    >
      {!searching && col.create !== false && (
        <p>
          <Link to={`/collections/${collectionKey}/new`} className="v-btn">
            <Plus /> Create the first {col.singular?.toLowerCase() ?? "entry"}
          </Link>
        </p>
      )}
    </EmptyState>
  );
}

function SortHeader({
  field,
  label,
  sort,
  onSort,
}: {
  field: string;
  label: string;
  sort: Sort | null;
  onSort: (field: string) => void;
}) {
  return (
    <th>
      <button type="button" onClick={() => onSort(field)}>
        {label}
        {sort?.field === field &&
          (sort.dir === "asc" ? <ArrowUp /> : <ArrowDown />)}
      </button>
    </th>
  );
}

type TableProps = {
  col: CollectionConfig;
  collectionKey: string;
  siteUrl?: string;
};

function EntryTable({
  entries,
  sort,
  onSort,
  ...props
}: TableProps & {
  entries: EntrySummary[];
  sort: Sort | null;
  onSort: (field: string) => void;
}) {
  const { col } = props;
  const columns = listColumns(col);
  // A collection with drafts shows their status, in its own column if no other has it.
  const statusColumn = col.status && !columns.some((c) => c.field === "status");
  return (
    <div className="v-table-wrap">
      <table className="v-table">
        <thead>
          <tr>
            <SortHeader
              field="title"
              label="Title"
              sort={sort}
              onSort={onSort}
            />
            {columns.map((c) => (
              <SortHeader
                key={c.field}
                field={c.field}
                label={columnLabel(col, c)}
                sort={sort}
                onSort={onSort}
              />
            ))}
            {statusColumn && <th>Status</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <EntryRow
              key={e.slug}
              entry={e}
              columns={columns}
              statusColumn={Boolean(statusColumn)}
              {...props}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntryRow({
  entry: e,
  columns,
  statusColumn,
  col,
  collectionKey,
  siteUrl,
}: TableProps & {
  entry: EntrySummary;
  columns: ListColumn[];
  statusColumn: boolean;
}) {
  return (
    <tr>
      <td className="v-table__main">
        <Link className="v-table__title" to={entryHref(collectionKey, e.slug)}>
          {e.title}
        </Link>
        <EntrySub entry={e} col={col} />
      </td>
      {columns.map((c) => (
        <td key={c.field} style={{ whiteSpace: "nowrap" }}>
          <EntryCell entry={e} field={c.field} col={col} />
        </td>
      ))}
      {statusColumn && (
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
            href={`${siteUrl ?? ""}${fillTemplate(col.previewUrl, { ...e.data, slug: e.slug })}`}
          >
            <ExternalLink />
          </a>
        )}
      </td>
    </tr>
  );
}

/** The line under an entry's title: its subtitle, or else its excerpt. */
function EntrySub({
  entry: e,
  col,
}: {
  entry: EntrySummary;
  col: CollectionConfig;
}) {
  const sub =
    e.data[col.titleField ?? "title"] !== undefined && e.data.subtitle
      ? String(e.data.subtitle)
      : e.excerpt;
  return sub ? <span className="v-table__sub">{sub}</span> : null;
}

function EntryCell({
  entry: e,
  field,
  col,
}: {
  entry: EntrySummary;
  field: string;
  col: CollectionConfig;
}) {
  if (field === "status") return <Badge status={e.status} />;
  if (field === "slug") return <span className="v-mono">{e.slug}</span>;
  return <CellValue field={col.schema[field]} value={e.data[field]} />;
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

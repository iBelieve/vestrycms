import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ExternalLink,
  Plus,
  Search,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type {
  CollectionConfig,
  Field,
  ListColumn,
} from "../../config/types.js";
import { basename, fillTemplate } from "../../core/paths.js";
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
import { type TreeRow, treeRows } from "../lib/entry-tree.js";
import {
  cx,
  entryHref,
  fieldLabel,
  formatDate,
  summarize,
  titleCase,
} from "../lib/utils.js";

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

  const [view, setView] = useStoredState<"tree" | "list">(
    `vestry:list-view:${key}`,
    "tree",
  );
  const [open, setOpen] = useStoredState<string[]>(
    `vestry:tree-open:${key}`,
    [],
  );
  const expanded = useMemo(() => new Set(open), [open]);
  const toggleOpen = (path: string) =>
    setOpen((o) =>
      o.includes(path) ? o.filter((p) => p !== path) : [...o, path],
    );

  const q = useQuery({
    queryKey: ["entries", key],
    queryFn: () => api.listEntries(key),
    enabled: Boolean(col),
  });

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
      const titleField = col?.titleField ?? "title";
      list = [...list].sort((a, b) => {
        const av = sortValue(a, sort.field, titleField);
        const bv = sortValue(b, sort.field, titleField);
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
    return list;
  }, [q.data, status, search, sort, col]);

  if (!col) return <NotFoundState title={`No collection called “${key}”`} />;
  const columns = listColumns(col);
  // A search or status filter lists its matches flat, wherever they sit.
  const tree =
    Boolean(col.tree) &&
    (col.tree === "only" || view === "tree") &&
    !search.trim() &&
    status === "all";

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
          {col.tree === true && (
            <div className="v-segment" aria-label="View">
              {(["tree", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={cx(view === v && "is-active")}
                  onClick={() => setView(v)}
                >
                  {titleCase(v)}
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
                      {columns.before.map((c) =>
                        header(c.field, columnLabel(col, c)),
                      )}
                      {header(columns.titleField, columns.titleLabel)}
                      {columns.after.map((c) =>
                        header(c.field, columnLabel(col, c)),
                      )}
                      {columns.extraStatus && <th>Status</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tree
                      ? treeRows(entries, expanded).map((row) => (
                          <EntryRow
                            key={row.path}
                            col={col}
                            colKey={key}
                            columns={columns}
                            siteUrl={config.siteUrl}
                            row={row}
                            open={expanded.has(row.path)}
                            onToggle={() => toggleOpen(row.path)}
                          />
                        ))
                      : entries.map((e) => (
                          <EntryRow
                            key={e.slug}
                            col={col}
                            colKey={key}
                            columns={columns}
                            siteUrl={config.siteUrl}
                            row={{
                              path: e.slug,
                              depth: 0,
                              entry: e,
                              label: e.title,
                              children: 0,
                            }}
                          />
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

type Columns = ReturnType<typeof listColumns>;

/** An entry's row (or, in a tree, a folder's), with its columns. */
function EntryRow({
  col,
  colKey,
  columns,
  siteUrl,
  row,
  open,
  onToggle,
}: {
  col: CollectionConfig;
  colKey: string;
  columns: Columns;
  siteUrl?: string;
  row: TreeRow;
  open?: boolean;
  onToggle?: () => void;
}) {
  const e = row.entry;
  const cells = (list: ListColumn[]) =>
    list.map((c) =>
      e ? (
        <ColumnCell key={c.field} col={col} column={c} entry={e} />
      ) : (
        <td key={c.field} />
      ),
    );
  return (
    <tr>
      {cells(columns.before)}
      <td className="v-table__main">
        <div
          className={cx(onToggle && "v-table__node")}
          style={onToggle ? { paddingLeft: `${row.depth * 22}px` } : undefined}
        >
          {onToggle &&
            (row.children > 0 ? (
              <button
                type="button"
                className="v-table__toggle"
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${row.label}`}
                onClick={onToggle}
              >
                <ChevronRight />
              </button>
            ) : (
              <span className="v-table__toggle" />
            ))}
          <div className="v-table__label">
            {e ? (
              <Link
                className="v-table__title"
                to={entryHref(colKey, e.slug)}
                title={row.label === e.title ? undefined : e.title}
              >
                {row.label}
              </Link>
            ) : (
              <span className="v-table__folder">{row.label}</span>
            )}
            {onToggle && row.children > 0 && !open && (
              <span className="v-table__count"> · {row.children}</span>
            )}
            {e && <EntrySubtitle col={col} entry={e} />}
          </div>
        </div>
      </td>
      {cells(columns.after)}
      {columns.extraStatus && <td>{e && <Badge status={e.status} />}</td>}
      <td className="v-table__actions">
        {e && col.previewUrl && (
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

/**
 * State kept in localStorage under `key`, so a view or an expanded folder
 * survives a reload. Storage that fails or holds garbage falls back to
 * `initial`.
 */
function useStoredState<T>(
  key: string,
  initial: T,
): [T, (update: ((value: T) => T) | T) => void] {
  const read = (): T => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  };
  const [state, setState] = useState<{ key: string; value: T }>(() => ({
    key,
    value: read(),
  }));
  const value = state.key === key ? state.value : read();
  const set = (update: ((value: T) => T) | T) =>
    setState((s) => {
      const current = s.key === key ? s.value : read();
      const next =
        typeof update === "function"
          ? (update as (value: T) => T)(current)
          : update;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not remembered, but still applied.
      }
      return { key, value: next };
    });
  return [value, set];
}

/**
 * The list's columns around the title. The title always shows, as the
 * entry's link; naming the title field in `columns` only places it (and may
 * relabel it), so it never appears twice.
 */
function listColumns(col: CollectionConfig) {
  const titleField = col.titleField ?? "title";
  const list = (col.columns ?? (col.sort?.field ? [col.sort.field] : [])).map(
    (c): ListColumn => (typeof c === "string" ? { field: c } : c),
  );
  const title = list.find((c) => c.field === titleField);
  const at = title ? list.indexOf(title) : 0;
  const rest = list.filter((c) => c.field !== titleField);
  return {
    // The title column sorts under the title field's key, so a separate
    // `title` field listed as a column still sorts by its own value.
    titleField,
    before: rest.slice(0, at),
    after: rest.slice(at),
    titleLabel: title ? columnLabel(col, title) : "Title",
    /** A collection with a status shows it even when `columns` leaves it out. */
    extraStatus: Boolean(col.status) && !list.some((c) => c.field === "status"),
  };
}

function columnLabel(col: CollectionConfig, c: ListColumn): string {
  if (c.label) return c.label;
  const f =
    c.field === "status" || c.field === "slug"
      ? undefined
      : col.schema[c.field];
  return f ? fieldLabel(c.field, f) : titleCase(c.field);
}

/** The line under an entry's title: its subtitle, or else its excerpt. */
function EntrySubtitle({
  col,
  entry,
}: {
  col: CollectionConfig;
  entry: EntrySummary;
}) {
  const sub =
    entry.data[col.titleField ?? "title"] !== undefined && entry.data.subtitle
      ? String(entry.data.subtitle)
      : entry.excerpt;
  return sub ? <span className="v-table__sub">{sub}</span> : null;
}

function ColumnCell({
  col,
  column,
  entry,
}: {
  col: CollectionConfig;
  column: ListColumn;
  entry: EntrySummary;
}) {
  return (
    <td className="v-table__cell">
      <div className="v-table__clip">
        {column.field === "status" ? (
          <Badge status={entry.status} />
        ) : column.field === "slug" ? (
          <span className="v-mono">{entry.slug}</span>
        ) : (
          <CellValue
            field={col.schema[column.field]}
            value={entry.data[column.field]}
          />
        )}
      </div>
    </td>
  );
}

/** What an entry is sorted by in a column. */
function sortValue(
  entry: EntrySummary,
  field: string,
  titleField: string,
): string {
  if (field === titleField) return entry.title;
  if (field === "slug") return entry.slug;
  return String(entry.data[field] ?? "");
}

function CellValue({ field, value }: { field?: Field; value: unknown }) {
  const { api } = useVestry();
  if (value === undefined || value === null || value === "")
    return <span className="v-faint">—</span>;
  if (!field) return <>{String(value)}</>;
  switch (field.type) {
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
    case "multiselect":
      return Array.isArray(value) ? (
        <ListValue of={field} items={value} />
      ) : null;
    case "array":
      return Array.isArray(value) ? (
        <ListValue of={field.of} items={value} />
      ) : null;
    case "object":
      return <span className="v-muted">…</span>;
    default:
      return <>{valueText(field, value)}</>;
  }
}

/**
 * A list in a column: the titles of the entries it refers to, or its values,
 * joined; a list of objects shows how many it holds. Blank items are skipped.
 */
function ListValue({ of, items }: { of: Field; items: unknown[] }) {
  const shown = items.filter((v) => v !== undefined && v !== null && v !== "");
  if (shown.length === 0) return <span className="v-faint">—</span>;
  if (of.type === "reference")
    return (
      <>
        {shown.map((id, i) => (
          <Fragment key={i}>
            {i > 0 && ", "}
            <ReferenceLabel collection={of.collection} id={String(id)} />
          </Fragment>
        ))}
      </>
    );
  if (shown.every((v) => typeof v !== "object"))
    return <>{shown.map((v) => valueText(of, v)).join(", ")}</>;
  return <>{summarize(shown)}</>;
}

/** A single value as text: an option's label, a date, Yes or No, a file name. */
function valueText(field: Field, value: unknown): string {
  switch (field.type) {
    case "select":
    case "multiselect":
      return (
        field.options.find((o) => o.value === value)?.label || String(value)
      );
    case "date":
    case "datetime":
      return formatDate(value);
    case "boolean":
      return value ? "Yes" : "No";
    case "image":
    case "file":
      return basename(String(value));
    default:
      return String(value);
  }
}

/** Each fetched list's titles by slug, so labels look an entry up directly. */
const titlesBySlug = new WeakMap<EntrySummary[], Map<string, string>>();

function entryTitle(entries: EntrySummary[], slug: string) {
  let titles = titlesBySlug.get(entries);
  if (!titles) {
    titles = new Map(entries.map((e) => [e.slug, e.title]));
    titlesBySlug.set(entries, titles);
  }
  return titles.get(slug);
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
  return <>{(q.data && entryTitle(q.data.entries, id)) ?? id}</>;
}

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
import {
  basename,
  fillTemplate,
  isEditable,
  pinnedEntries,
} from "../../core/paths.js";
import { compareSortValues } from "../../core/values.js";
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

type Status = "all" | "published" | "draft";
type Sort = { field: string; dir: "asc" | "desc" };

export function CollectionListPage() {
  const { collection: key = "" } = useParams();
  const { config, api } = useVestry();
  const col = config.collections?.[key];
  const { search, setSearch, status, setStatus, sort, setSort, view, setView } =
    useListFilters(key);

  const q = useQuery({
    queryKey: ["entries", key],
    queryFn: () => api.listEntries(key),
    enabled: Boolean(col),
  });

  const entries = useMemo(
    () =>
      col && q.data
        ? sortEntries(
            filterEntries(q.data.entries, col, status, search),
            sort,
            col.titleField ?? "title",
          )
        : [],
    [q.data, status, search, sort, col],
  );

  if (!col) return <NotFoundState title={`No collection called “${key}”`} />;
  return (
    <>
      <TopBar
        title={col.label}
        actions={
          isEditable(col) && (
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
            <Segment
              options={["all", "published", "draft"] as const}
              value={status}
              onChange={setStatus}
            />
          )}
          {col.tree === true && (
            <Segment
              label="View"
              options={["tree", "list"] as const}
              value={view}
              onChange={setView}
            />
          )}
        </div>
        <div className="v-card">
          {q.isLoading && <Loading />}
          {q.error && (
            <div style={{ padding: 18 }}>
              <Alert kind="error">{q.error.message}</Alert>
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
                colKey={key}
                siteUrl={config.siteUrl}
                entries={entries}
                tree={showsTree(col, view, search, status)}
                sort={sort}
                onSort={(field) => setSort((s) => nextSort(s, field))}
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

/** The list's search, status filter, sort and (remembered) view. */
function useListFilters(key: string) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [sort, setSort] = useState<Sort | null>(null);
  const [view, setView] = useStoredState(
    `vestry:list-view:${key}`,
    "tree",
    (v): v is "tree" | "list" => v === "tree" || v === "list",
  );
  return { search, setSearch, status, setStatus, sort, setSort, view, setView };
}

/**
 * Whether the entries show as a tree: in a tree collection's tree view, but
 * a search or status filter lists its matches flat, wherever they sit.
 */
function showsTree(
  col: CollectionConfig,
  view: "tree" | "list",
  search: string,
  status: Status,
): boolean {
  if (!col.tree || search.trim() || status !== "all") return false;
  return col.tree === "only" || view === "tree";
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

function sortEntries(
  entries: EntrySummary[],
  sort: Sort | null,
  titleField: string,
): EntrySummary[] {
  if (!sort) return entries;
  const dir = sort.dir === "asc" ? 1 : -1;
  // The same order as the server's: numbers as numbers, missing last, and
  // ties by title.
  return [...entries].sort(
    (a, b) =>
      compareSortValues(
        sortValue(a, sort.field, titleField),
        sortValue(b, sort.field, titleField),
        dir,
      ) || a.title.localeCompare(b.title),
  );
}

/** A row of buttons choosing one of `options`, each labelled in title case. */
function Segment<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="v-segment" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={cx(value === o && "is-active")}
          onClick={() => onChange(o)}
        >
          {titleCase(o)}
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
      {!searching && isEditable(col) && (
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

type RowProps = {
  col: CollectionConfig;
  colKey: string;
  columns: Columns;
  siteUrl?: string;
};

/** The entries as a table, or in a tree by their folders. */
function EntryTable({
  entries,
  tree,
  sort,
  onSort,
  ...props
}: Omit<RowProps, "columns"> & {
  entries: EntrySummary[];
  tree: boolean;
  sort: Sort | null;
  onSort: (field: string) => void;
}) {
  const { col } = props;
  const columns = listColumns(col);
  const { pinned, rest } = splitPinned(col, entries);
  const header = (c: ListColumn) => (
    <SortHeader
      key={c.field}
      field={c.field}
      label={columnLabel(col, c)}
      sort={sort}
      onSort={onSort}
    />
  );
  return (
    <div className="v-table-wrap">
      <table className="v-table">
        <thead>
          <tr>
            {columns.before.map(header)}
            <SortHeader
              field={columns.titleField}
              label={columns.titleLabel}
              sort={sort}
              onSort={onSort}
            />
            {columns.after.map(header)}
            {columns.extraStatus && <th>Status</th>}
            <th />
          </tr>
        </thead>
        {pinned.length > 0 && (
          <tbody>
            {pinned.map(({ entry, icon }) => (
              <EntryRow
                key={entry.slug}
                {...props}
                columns={columns}
                row={flatRow(entry)}
                pinned={{ icon, inTree: tree }}
              />
            ))}
          </tbody>
        )}
        {pinned.length > 0 && rest.length > 0 && (
          <tbody className="v-table__divider" aria-hidden="true">
            <tr>
              <td colSpan={columnCount(columns)} />
            </tr>
          </tbody>
        )}
        <tbody>
          {tree ? (
            <TreeRows entries={rest} {...props} columns={columns} />
          ) : (
            rest.map((e) => (
              <EntryRow
                key={e.slug}
                {...props}
                columns={columns}
                row={flatRow(e)}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** A pinned entry and the icon shown before its title. */
type Pinned = { entry: EntrySummary; icon?: string };

/**
 * The collection's pinned entries (`pinnedEntries`), in their order,
 * whatever the sort or view; and the rest, in the list's order. Slugs match
 * ignoring case, as reserved slugs do.
 */
function splitPinned(
  col: CollectionConfig,
  entries: EntrySummary[],
): { pinned: Pinned[]; rest: EntrySummary[] } {
  const list = pinnedEntries(col);
  if (list.length === 0) return { pinned: [], rest: entries };
  // Each slug's first place in the list, and its icon.
  const order = new Map<string, { rank: number; icon?: string }>();
  for (const [rank, { slug, icon }] of list.entries())
    if (!order.has(slug.toLowerCase()))
      order.set(slug.toLowerCase(), { rank, icon });
  const pinned: (Pinned & { rank: number })[] = [];
  const rest: EntrySummary[] = [];
  for (const entry of entries) {
    const at = order.get(entry.slug.toLowerCase());
    if (at) pinned.push({ entry, ...at });
    else rest.push(entry);
  }
  pinned.sort((a, b) => a.rank - b.rank);
  return { pinned, rest };
}

/** An entry's row in a flat list. */
function flatRow(entry: EntrySummary): TreeRow {
  return { path: entry.slug, depth: 0, entry, label: entry.title, children: 0 };
}

/** How many cells a row of the table has. */
function columnCount(columns: Columns): number {
  // The title and the actions, around the configured columns.
  return (
    columns.before.length +
    columns.after.length +
    (columns.extraStatus ? 1 : 0) +
    2
  );
}

/** The entries by their folders, each folder remembered open or closed. */
function TreeRows({
  entries,
  ...props
}: RowProps & { entries: EntrySummary[] }) {
  const [open, setOpen] = useStoredState(
    `vestry:tree-open:${props.colKey}`,
    NONE_OPEN,
    (v): v is string[] =>
      Array.isArray(v) && v.every((p) => typeof p === "string"),
  );
  const expanded = useMemo(() => new Set(open), [open]);
  const toggleOpen = (path: string) =>
    setOpen((o) =>
      o.includes(path) ? o.filter((p) => p !== path) : [...o, path],
    );
  return (
    <>
      {treeRows(entries, expanded).map((row) => (
        <EntryRow
          key={row.path}
          {...props}
          row={row}
          open={expanded.has(row.path)}
          onToggle={() => toggleOpen(row.path)}
        />
      ))}
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
  pinned,
}: RowProps & {
  row: TreeRow;
  open?: boolean;
  onToggle?: () => void;
  pinned?: PinnedRow;
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
          className={cx((onToggle || pinned?.inTree) && "v-table__node")}
          style={onToggle ? { paddingLeft: `${row.depth * 22}px` } : undefined}
        >
          {pinned?.inTree && <span className="v-table__toggle" />}
          {onToggle && <NodeToggle row={row} open={open} onToggle={onToggle} />}
          <RowLabel
            col={col}
            colKey={colKey}
            row={row}
            folded={!!onToggle && !open}
            pinned={pinned}
          />
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

/** Opens or closes a tree row with children; a spacer for one without. */
function NodeToggle({
  row,
  open,
  onToggle,
}: {
  row: TreeRow;
  open?: boolean;
  onToggle: () => void;
}) {
  if (row.children === 0) return <span className="v-table__toggle" />;
  return (
    <button
      type="button"
      className="v-table__toggle"
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${row.entry?.title ?? row.label}`}
      onClick={onToggle}
    >
      <ChevronRight />
    </button>
  );
}

/**
 * The row's link to its entry (or a folder's name), with a closed folder's
 * count and the entry's subtitle.
 */
function RowLabel({
  col,
  colKey,
  row,
  folded,
  pinned,
}: {
  col: CollectionConfig;
  colKey: string;
  row: TreeRow;
  /** A closed tree row, which shows how many rows it hides. */
  folded: boolean;
  pinned?: PinnedRow;
}) {
  const e = row.entry;
  return (
    <div className="v-table__label">
      {e ? (
        <EntryLink
          colKey={colKey}
          entry={e}
          label={row.label}
          pinned={pinned}
        />
      ) : (
        <span className="v-table__folder">{row.label}</span>
      )}
      {folded && row.children > 0 && (
        <span className="v-table__count"> · {row.children}</span>
      )}
      {e && <EntrySubtitle col={col} entry={e} />}
    </div>
  );
}

/**
 * How a pinned entry's row differs: an icon before its title, and above a
 * tree, out of its folder, lined up with the tree's rows (past their
 * toggles) and showing its slug.
 */
type PinnedRow = { icon?: string; inTree: boolean };

/**
 * The link to an entry, with a pinned entry's icon before it and, above a
 * tree, its slug after it (unless the label already is the slug, as an
 * untitled entry's is).
 */
function EntryLink({
  colKey,
  entry,
  label,
  pinned,
}: {
  colKey: string;
  entry: EntrySummary;
  label: string;
  pinned?: PinnedRow;
}) {
  const link = (
    <Link
      className="v-table__title"
      to={entryHref(colKey, entry.slug)}
      title={label === entry.title ? undefined : entry.title}
    >
      {label}
    </Link>
  );
  const path =
    pinned?.inTree && entry.slug.includes("/") && label !== entry.slug;
  if (!pinned?.icon && !path) return link;
  return (
    <span className="v-table__marked">
      {pinned?.icon && (
        <Icon className="v-table__pin-icon" name={pinned.icon} aria-hidden />
      )}
      {link}
      {path && <span className="v-table__path v-mono">{entry.slug}</span>}
    </span>
  );
}

const NONE_OPEN: string[] = [];

/**
 * State kept in localStorage under `key`, so a view or an expanded folder
 * survives a reload. Storage that fails, or holds anything `valid` rejects,
 * falls back to `initial`.
 */
function useStoredState<T>(
  key: string,
  initial: T,
  valid: (value: unknown) => value is T,
): [T, (update: ((value: T) => T) | T) => void] {
  const read = (): T => {
    try {
      const raw = localStorage.getItem(key);
      const stored: unknown = raw === null ? initial : JSON.parse(raw);
      return valid(stored) ? stored : initial;
    } catch {
      return initial;
    }
  };
  const [state, setState] = useState<{ key: string; value: T }>(() => ({
    key,
    value: read(),
  }));
  // Another collection's list (the page stays mounted): read its key once.
  let value = state.value;
  if (state.key !== key) {
    value = read();
    setState({ key, value });
  }
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
): unknown {
  if (field === titleField) return entry.title;
  if (field === "slug") return entry.slug;
  // The column shows the entry's status, which `data` holds under the
  // status field's own key, if at all.
  if (field === "status") return entry.status;
  return entry.data[field];
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

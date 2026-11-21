/** Searching and sorting the files on the Assets page. */
import type { AssetItem } from "../../core/service.js";

export type AssetSortField = "name" | "type" | "size";
export type AssetSort = { field: AssetSortField; dir: "asc" | "desc" };

/** `path` relative to `base` (a folder), or the whole path outside it. */
export function relativeTo(base: string, path: string): string {
  return base && path.startsWith(`${base}/`)
    ? path.slice(base.length + 1)
    : path;
}

/**
 * The files whose path under `base` holds every word of `search`, ignoring
 * case, so "2019 bulletin" finds `2019/bulletin-03.pdf` as well as
 * `bulletin-2019.pdf`.
 */
export function matchAssets(
  items: AssetItem[],
  search: string,
  base: string,
): AssetItem[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const path = relativeTo(base, item.path).toLowerCase();
    return words.every((w) => path.includes(w));
  });
}

/** The next sort after clicking `field`'s header: ascending, then descending. */
export function nextAssetSort(
  sort: AssetSort,
  field: AssetSortField,
): AssetSort {
  if (sort.field !== field) return { field, dir: "asc" };
  return { field, dir: sort.dir === "asc" ? "desc" : "asc" };
}

const compare: Record<AssetSortField, (a: AssetItem, b: AssetItem) => number> =
  {
    name: () => 0,
    type: (a, b) => a.ext.localeCompare(b.ext),
    size: (a, b) => (a.size ?? 0) - (b.size ?? 0),
  };

/** The files in `sort`'s order, by name (then path) where it ties. */
export function sortAssets(items: AssetItem[], sort: AssetSort): AssetItem[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const byName = (a: AssetItem, b: AssetItem) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }) ||
    a.path.localeCompare(b.path);
  return [...items].sort(
    (a, b) =>
      sign * compare[sort.field](a, b) ||
      (sort.field === "name" ? sign : 1) * byName(a, b),
  );
}

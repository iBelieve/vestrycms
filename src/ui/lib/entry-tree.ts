import { basename, dirname } from "../../core/paths.js";
import type { EntrySummary } from "../../core/service.js";

/** One row of a collection's tree: an entry, or a folder with no entry of its own. */
export interface TreeRow {
  /** The entry's slug, or the folder's path. */
  path: string;
  depth: number;
  entry?: EntrySummary;
  /** The title shown, without the part it repeats from its parent's title. */
  label: string;
  /** How many rows sit directly under this one. */
  children: number;
}

interface Node {
  path: string;
  entry?: EntrySummary;
  children: Node[];
}

/**
 * Nests entries by the folders in their slugs: `cw21/1year/advent` sits under
 * `cw21/1year`, which sits under `cw21`. A folder with no entry of its own
 * becomes a row named after the folder, where its first entry falls.
 * Siblings keep the order of `entries`: a parent takes its own place there,
 * not its first child's.
 */
function buildTree(entries: EntrySummary[]): Node[] {
  // Every entry has its node before any is placed, so a child listed before
  // its parent joins the parent's node without placing it early.
  const nodes = new Map<string, Node>();
  for (const entry of entries)
    if (!nodes.has(entry.slug))
      nodes.set(entry.slug, { path: entry.slug, entry, children: [] });
  const roots: Node[] = [];
  const placed = new Set<Node>();
  const place = (node: Node) => {
    if (placed.has(node)) return;
    placed.add(node);
    (node.path.includes("/")
      ? nodeFor(dirname(node.path)).children
      : roots
    ).push(node);
  };
  const nodeFor = (path: string): Node => {
    let node = nodes.get(path);
    if (!node) {
      node = { path, children: [] };
      nodes.set(path, node);
      place(node);
    }
    return node;
  };
  for (const entry of entries) place(nodes.get(entry.slug)!);
  return roots;
}

/**
 * A child's title without the part it repeats from its parent's:
 * "CW21 - 1-Year Lectionary: Advent" under "CW21 - 1-Year Lectionary" is
 * "Advent". The title is kept whole unless separators (spaces, `:`, `-`,
 * `–`, `—`, `,`) follow the shared part and something follows them.
 */
export function relativeTitle(title: string, parentTitle?: string): string {
  if (!parentTitle || !title.startsWith(parentTitle)) return title;
  const rest = /^[\s:,\-–—]+(\S.*)$/s.exec(title.slice(parentTitle.length));
  return rest ? rest[1] : title;
}

/**
 * The rows to show: every root, and the children of each expanded row, in
 * tree order.
 */
export function treeRows(
  entries: EntrySummary[],
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (nodes: Node[], depth: number, parentTitle?: string) => {
    for (const node of nodes) {
      // An entry with no title of its own is titled by its slug; like a
      // folder, it shows the last part.
      const title =
        node.entry && node.entry.title !== node.entry.slug
          ? node.entry.title
          : undefined;
      rows.push({
        path: node.path,
        depth,
        entry: node.entry,
        label:
          title === undefined
            ? basename(node.path)
            : relativeTitle(title, parentTitle),
        children: node.children.length,
      });
      // Under a folder, children are shortened by the nearest title above.
      if (expanded.has(node.path))
        walk(node.children, depth + 1, title ?? parentTitle);
    }
  };
  walk(buildTree(entries), 0);
  return rows;
}

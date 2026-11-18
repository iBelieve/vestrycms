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

const parentPath = (path: string) => path.slice(0, path.lastIndexOf("/"));

/**
 * Nests entries by the folders in their slugs: `cw21/1year/advent` sits under
 * `cw21/1year`, which sits under `cw21`. A folder with no entry of its own
 * becomes a row named after the folder. Siblings keep the order of `entries`.
 */
function buildTree(entries: EntrySummary[]): Node[] {
  const nodes = new Map<string, Node>();
  const roots: Node[] = [];
  const nodeFor = (path: string): Node => {
    let node = nodes.get(path);
    if (node) return node;
    node = { path, children: [] };
    nodes.set(path, node);
    (path.includes("/") ? nodeFor(parentPath(path)).children : roots).push(
      node,
    );
    return node;
  };
  for (const entry of entries) nodeFor(entry.slug).entry = entry;
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
      const title = node.entry?.title;
      rows.push({
        path: node.path,
        depth,
        entry: node.entry,
        label:
          title === undefined
            ? node.path.slice(node.path.lastIndexOf("/") + 1)
            : relativeTitle(title, parentTitle),
        children: node.children.length,
      });
      if (expanded.has(node.path)) walk(node.children, depth + 1, title);
    }
  };
  walk(buildTree(entries), 0);
  return rows;
}

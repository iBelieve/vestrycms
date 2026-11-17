/**
 * The tree input's model: the stored nested arrays given stable ids, flattened
 * into rows for display, and the moves a drag makes.
 */
import { arrayMove } from "@dnd-kit/sortable";

/** Pixels of indent per level, and of sideways drag per level. */
export const INDENT = 28;
let nextId = 0;
export const newId = () => `node-${++nextId}`;

export type NodeData = Record<string, unknown>;

/** Internal tree with stable ids; the stored value has none. */
export interface TreeNode {
  id: string;
  data: NodeData;
  children: TreeNode[];
}

export interface FlatNode {
  id: string;
  data: NodeData;
  depth: number;
  parentId: string | null;
  childCount: number;
}

export function annotate(value: unknown, key: string): TreeNode[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const node = raw && typeof raw === "object" ? (raw as NodeData) : {};
    const { [key]: children, ...data } = node;
    return { id: newId(), data, children: annotate(children, key) };
  });
}

export function strip(nodes: TreeNode[], key: string): NodeData[] {
  return nodes.map((n) =>
    n.children.length
      ? { ...n.data, [key]: strip(n.children, key) }
      : { ...n.data },
  );
}

export function flatten(
  nodes: TreeNode[],
  collapsed: Set<string>,
  parentId: string | null = null,
  depth = 0,
): FlatNode[] {
  return nodes.flatMap((n) => [
    { id: n.id, data: n.data, depth, parentId, childCount: n.children.length },
    ...(collapsed.has(n.id)
      ? []
      : flatten(n.children, collapsed, n.id, depth + 1)),
  ]);
}

export function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const inner = findNode(n.children, id);
    if (inner) return inner;
  }
  return null;
}

export function mapTree(
  nodes: TreeNode[],
  fn: (n: TreeNode) => TreeNode,
): TreeNode[] {
  return nodes.map((n) => fn({ ...n, children: mapTree(n.children, fn) }));
}

export function removeNode(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

export function insertNode(
  nodes: TreeNode[],
  parentId: string | null,
  index: number,
  node: TreeNode,
): TreeNode[] {
  if (parentId === null) {
    const next = [...nodes];
    next.splice(index, 0, node);
    return next;
  }
  return nodes.map((n) =>
    n.id === parentId
      ? { ...n, children: insertNode(n.children, null, index, node) }
      : { ...n, children: insertNode(n.children, parentId, index, node) },
  );
}

export function descendantIds(node: TreeNode): string[] {
  return node.children.flatMap((c) => [c.id, ...descendantIds(c)]);
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** Where the dragged item would land: depth and parent, from its horizontal offset. */
export function getProjection(
  items: FlatNode[],
  activeId: string,
  overId: string,
  offsetX: number,
  maxDepth: number,
) {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const active = items[activeIndex];
  if (!active || overIndex === -1) return null;
  const moved = arrayMove(items, activeIndex, overIndex);
  const previous = moved[overIndex - 1];
  const next = moved[overIndex + 1];
  const projected = active.depth + Math.round(offsetX / INDENT);
  const upper = Math.min(previous ? previous.depth + 1 : 0, maxDepth - 1);
  const lower = next ? next.depth : 0;
  const depth = clamp(projected, Math.min(lower, upper), upper);
  let parentId: string | null = null;
  if (depth > 0 && previous) {
    if (depth === previous.depth) parentId = previous.parentId;
    else if (depth > previous.depth) parentId = previous.id;
    else {
      const ancestor = moved
        .slice(0, overIndex)
        .reverse()
        .find((i) => i.depth === depth);
      parentId = ancestor?.parentId ?? null;
    }
  }
  return { depth, parentId, overIndex, moved };
}

/**
 * The tree with node `activeId` moved where `projection` puts it: under its
 * parent, after the siblings that come before it in the moved rows. Null when
 * there is nothing to drop.
 */
export function dropNode(
  tree: TreeNode[],
  activeId: string,
  projection: ReturnType<typeof getProjection>,
): TreeNode[] | null {
  const node = findNode(tree, activeId);
  if (!projection || !node) return null;
  const { parentId, moved, overIndex } = projection;
  const siblingsBefore = moved
    .slice(0, overIndex)
    .filter((i) => i.parentId === parentId && i.id !== activeId).length;
  return insertNode(removeNode(tree, activeId), parentId, siblingsBefore, node);
}

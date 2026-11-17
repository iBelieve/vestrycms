import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  GripVertical,
  Pencil,
  Plus,
  Trash,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TreeField } from "../../../config/types.js";
import {
  cx,
  defaultValues,
  fieldLabel,
  type ValidationError,
} from "../../lib/utils.js";
import { Button } from "../ui.js";
// Tree items render their fields with FieldSet, which renders TreeInput:
// recursion at render time, not at module initialization.
// fallow-ignore-next-line circular-dependency
import { FieldSet, type FieldContext } from "./FieldRenderer.js";

const INDENT = 28;
let nextId = 0;
const newId = () => `node-${++nextId}`;

type NodeData = Record<string, unknown>;

/** Internal tree with stable ids; the stored value has none. */
interface TreeNode {
  id: string;
  data: NodeData;
  children: TreeNode[];
}

interface FlatNode {
  id: string;
  data: NodeData;
  depth: number;
  parentId: string | null;
  childCount: number;
}

function annotate(value: unknown, key: string): TreeNode[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const node = raw && typeof raw === "object" ? (raw as NodeData) : {};
    const { [key]: children, ...data } = node;
    return { id: newId(), data, children: annotate(children, key) };
  });
}

function strip(nodes: TreeNode[], key: string): NodeData[] {
  return nodes.map((n) =>
    n.children.length
      ? { ...n.data, [key]: strip(n.children, key) }
      : { ...n.data },
  );
}

function flatten(
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

function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const inner = findNode(n.children, id);
    if (inner) return inner;
  }
  return null;
}

function mapTree(nodes: TreeNode[], fn: (n: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((n) => fn({ ...n, children: mapTree(n.children, fn) }));
}

function removeNode(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

function insertNode(
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

function descendantIds(node: TreeNode): string[] {
  return node.children.flatMap((c) => [c.id, ...descendantIds(c)]);
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** Where the dragged item would land: depth and parent, from its horizontal offset. */
function getProjection(
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

export function TreeInput({
  field,
  value,
  onChange,
  errors,
  ctx,
  path,
}: {
  field: TreeField;
  value: unknown;
  onChange: (v: NodeData[]) => void;
  errors?: ValidationError[];
  ctx?: FieldContext;
  path: string;
}) {
  const key = field.childrenKey ?? "children";
  const maxDepth = field.maxDepth ?? 99;
  const labelKey = field.itemLabel ?? "title";
  const detailKey =
    field.itemDetail ??
    Object.keys(field.fields).find(
      (k) => k !== labelKey && field.fields[k].type === "text",
    );

  const [tree, setTree] = useState<TreeNode[]>(() => annotate(value, key));
  const lastEmitted = useRef<string>(JSON.stringify(strip(tree, key)));
  useEffect(() => {
    const incoming = JSON.stringify(Array.isArray(value) ? value : []);
    if (incoming !== lastEmitted.current) {
      lastEmitted.current = incoming;
      setTree(annotate(value, key));
    }
  }, [value, key]);
  const commit = (next: TreeNode[]) => {
    setTree(next);
    const plain = strip(next, key);
    lastEmitted.current = JSON.stringify(plain);
    onChange(plain);
  };

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);

  const flat = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);
  // While dragging, the active node's descendants travel with it and are hidden.
  const visible = useMemo(() => {
    if (!activeId) return flat;
    const node = findNode(tree, activeId);
    const hidden = new Set(node ? descendantIds(node) : []);
    return flat.filter((i) => !hidden.has(i.id));
  }, [flat, activeId, tree]);
  const projection =
    activeId && overId
      ? getProjection(visible, activeId, overId, offsetX, maxDepth)
      : null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const active = String(e.active.id);
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
    if (!projection || !e.over) return;
    const node = findNode(tree, active);
    if (!node) return;
    const { parentId, moved, overIndex } = projection;
    const siblingsBefore = moved
      .slice(0, overIndex)
      .filter((i) => i.parentId === parentId && i.id !== active).length;
    const without = removeNode(tree, active);
    commit(insertNode(without, parentId, siblingsBefore, node));
    if (parentId)
      setCollapsed((c) => {
        const n = new Set(c);
        n.delete(parentId);
        return n;
      });
  };

  const update = (id: string, data: NodeData) =>
    commit(mapTree(tree, (n) => (n.id === id ? { ...n, data } : n)));
  const remove = (id: string) => {
    commit(removeNode(tree, id));
    if (editing === id) setEditing(null);
  };
  const add = (parentId: string | null) => {
    const node: TreeNode = {
      id: newId(),
      data: defaultValues(field.fields),
      children: [],
    };
    const parent = parentId ? findNode(tree, parentId) : null;
    commit(
      insertNode(
        tree,
        parentId,
        parent ? parent.children.length : tree.length,
        node,
      ),
    );
    if (parentId)
      setCollapsed((c) => {
        const n = new Set(c);
        n.delete(parentId);
        return n;
      });
    setEditing(node.id);
  };
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const labelOf = (data: NodeData) => {
    const v = data[labelKey];
    return typeof v === "string" && v.trim() ? v : "Untitled";
  };
  const detailOf = (data: NodeData) =>
    detailKey && typeof data[detailKey] === "string"
      ? (data[detailKey] as string)
      : "";
  const activeNode = activeId ? findNode(tree, activeId) : null;

  return (
    <div className="v-tree">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => {
          setActiveId(String(e.active.id));
          setOverId(String(e.active.id));
          setEditing(null);
        }}
        onDragMove={(e: DragMoveEvent) => setOffsetX(e.delta.x)}
        onDragOver={(e: DragOverEvent) =>
          setOverId(e.over ? String(e.over.id) : null)
        }
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setOverId(null);
          setOffsetX(0);
        }}
      >
        <SortableContext
          items={visible.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {visible.length === 0 && (
            <div className="v-tree__empty">No items yet.</div>
          )}
          {visible.map((item) => (
            <TreeRow
              key={item.id}
              item={item}
              depth={
                activeId === item.id && projection
                  ? projection.depth
                  : item.depth
              }
              label={labelOf(item.data)}
              detail={detailOf(item.data)}
              collapsed={collapsed.has(item.id)}
              editing={editing === item.id}
              canAddChild={item.depth + 1 < maxDepth}
              onToggle={() => toggle(item.id)}
              onEdit={() => setEditing(editing === item.id ? null : item.id)}
              onAddChild={() => add(item.id)}
              onRemove={() => remove(item.id)}
            >
              {editing === item.id && (
                <div className="v-tree__form">
                  <FieldSet
                    schema={field.fields}
                    values={item.data}
                    onChange={(v) => update(item.id, v)}
                    errors={errors}
                    ctx={ctx}
                    pathPrefix={`${path}.${item.id}`}
                  />
                </div>
              )}
            </TreeRow>
          ))}
        </SortableContext>
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {activeNode && (
              <div className="v-tree__item v-tree__ghost">
                <span className="v-list__handle">
                  <GripVertical />
                </span>
                <span className="v-tree__label">
                  {labelOf(activeNode.data)}
                </span>
                {activeNode.children.length > 0 && (
                  <span className="v-tree__count">
                    +{descendantIds(activeNode).length}
                  </span>
                )}
              </div>
            )}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      <Button size="sm" className="v-list__add" onClick={() => add(null)}>
        <Plus />{" "}
        {field.addLabel ?? `Add ${fieldLabel("item", field).toLowerCase()}`}
      </Button>
    </div>
  );
}

function TreeRow({
  item,
  depth,
  label,
  detail,
  collapsed,
  editing,
  canAddChild,
  onToggle,
  onEdit,
  onAddChild,
  onRemove,
  children,
}: {
  item: FlatNode;
  depth: number;
  label: string;
  detail: string;
  collapsed: boolean;
  editing: boolean;
  canAddChild: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAddChild: () => void;
  onRemove: () => void;
  children?: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      className={cx(
        "v-tree__row",
        isDragging && "is-placeholder",
        editing && "is-editing",
      )}
      style={
        {
          transform: CSS.Translate.toString(transform),
          transition,
          paddingLeft: depth * INDENT,
          "--v-tree-indent": `${depth * INDENT}px`,
        } as React.CSSProperties
      }
    >
      <div className="v-tree__item">
        <span
          className="v-list__handle"
          title="Drag to move; drag sideways to nest"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          onPointerDown={(e) => {
            e.stopPropagation();
            (
              listeners?.onPointerDown as
                ((e: React.PointerEvent) => void) | undefined
            )?.(e);
          }}
        >
          <GripVertical />
        </span>
        {item.childCount > 0 ? (
          <button
            type="button"
            className="v-tree__toggle"
            onClick={onToggle}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronRight /> : <ChevronDown />}
          </button>
        ) : (
          <span className="v-tree__toggle v-tree__toggle--leaf" />
        )}
        <button type="button" className="v-tree__text" onClick={onEdit}>
          <span className="v-tree__label">{label}</span>
          {detail && <span className="v-tree__detail">{detail}</span>}
          {collapsed && item.childCount > 0 && (
            <span className="v-tree__count">{item.childCount}</span>
          )}
        </button>
        <div className="v-list__actions">
          {canAddChild && (
            <Button
              variant="ghost"
              size="xs"
              icon
              title="Add child"
              onClick={onAddChild}
            >
              <CornerDownRight />
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            icon
            title={editing ? "Done" : "Edit"}
            onClick={onEdit}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            icon
            title="Remove"
            onClick={onRemove}
          >
            <Trash />
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}

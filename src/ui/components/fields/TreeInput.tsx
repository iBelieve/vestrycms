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
import {
  INDENT,
  annotate,
  descendantIds,
  dropNode,
  findNode,
  flatten,
  getProjection,
  insertNode,
  mapTree,
  newId,
  removeNode,
  strip,
  type NodeData,
  type FlatNode,
  type TreeNode,
} from "./tree.js";

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
  // The tree as last changed, so that two changes at once both count.
  const latest = useRef(tree);
  latest.current = tree;
  const lastEmitted = useRef<string>(JSON.stringify(strip(tree, key)));
  useEffect(() => {
    const incoming = JSON.stringify(Array.isArray(value) ? value : []);
    if (incoming !== lastEmitted.current) {
      lastEmitted.current = incoming;
      setTree(annotate(value, key));
    }
  }, [value, key]);
  const commit = (next: TreeNode[]) => {
    latest.current = next;
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
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
    const next = e.over && dropNode(tree, String(e.active.id), projection);
    if (!next) return;
    commit(next);
    expand(projection!.parentId);
  };

  const update = (id: string, change: (data: NodeData) => NodeData) =>
    commit(
      mapTree(latest.current, (n) =>
        n.id === id ? { ...n, data: change(n.data) } : n,
      ),
    );
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
    expand(parentId);
    setEditing(node.id);
  };
  /** Shows a node's children. */
  const expand = (id: string | null) =>
    id &&
    setCollapsed((c) => {
      const n = new Set(c);
      n.delete(id);
      return n;
    });
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
                    onChange={(change) => update(item.id, change)}
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
          <DragOverlay className="v-portal" dropAnimation={null}>
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

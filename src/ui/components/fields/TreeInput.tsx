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
  inSentence,
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
  const keys = treeKeys(field);
  const { tree, latest, commit } = useTreeValue(value, keys.children, onChange);
  const { collapsed, expand, toggle } = useCollapsed();
  const [editing, setEditing] = useState<string | null>(null);
  const drag = useTreeDrag(tree, collapsed, keys.maxDepth);

  const onDragEnd = (e: DragEndEvent) => {
    const projection = drag.end();
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
    commit(removeNode(latest.current, id));
    if (editing === id) setEditing(null);
  };
  const add = (parentId: string | null) => {
    const node: TreeNode = {
      id: newId(),
      data: defaultValues(field.fields),
      children: [],
    };
    const current = latest.current;
    const parent = parentId ? findNode(current, parentId) : null;
    commit(
      insertNode(
        current,
        parentId,
        parent ? parent.children.length : current.length,
        node,
      ),
    );
    expand(parentId);
    setEditing(node.id);
  };

  return (
    <div className="v-tree">
      <DndContext
        sensors={drag.sensors}
        collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => {
          drag.start(String(e.active.id));
          setEditing(null);
        }}
        onDragMove={(e: DragMoveEvent) => drag.move(e.delta.x)}
        onDragOver={(e: DragOverEvent) =>
          drag.over(e.over ? String(e.over.id) : null)
        }
        onDragEnd={onDragEnd}
        onDragCancel={() => drag.end()}
      >
        <SortableContext
          items={drag.visible.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {drag.visible.length === 0 && (
            <div className="v-tree__empty">No items yet.</div>
          )}
          {drag.visible.map((item) => (
            <TreeRow
              key={item.id}
              item={item}
              depth={drag.depthOf(item)}
              view={{
                label: nodeLabel(item.data, keys.label),
                detail: nodeDetail(item.data, keys.detail),
                collapsed: collapsed.has(item.id),
                editing: editing === item.id,
                canAddChild: item.depth + 1 < keys.maxDepth,
                readOnly: Boolean(field.readOnly),
              }}
              actions={{
                onToggle: () => toggle(item.id),
                onEdit: () => setEditing(editing === item.id ? null : item.id),
                onAddChild: () => add(item.id),
                onRemove: () => remove(item.id),
              }}
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
            {drag.activeId && (
              <DragGhost
                node={findNode(tree, drag.activeId)}
                labelKey={keys.label}
              />
            )}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      <Button size="sm" className="v-list__add" onClick={() => add(null)}>
        <Plus />{" "}
        {field.addLabel ?? `Add ${inSentence(fieldLabel("item", field))}`}
      </Button>
    </div>
  );
}

/** The field's settings, with their defaults. */
function treeKeys(field: TreeField) {
  const label = field.itemLabel ?? "title";
  return {
    children: field.childrenKey ?? "children",
    maxDepth: field.maxDepth ?? 99,
    label,
    // By default the detail is the first text field other than the label.
    detail:
      field.itemDetail ??
      Object.keys(field.fields).find(
        (k) => k !== label && field.fields[k].type === "text",
      ),
  };
}

function nodeLabel(data: NodeData, labelKey: string): string {
  const v = data[labelKey];
  return typeof v === "string" && v.trim() ? v : "Untitled";
}

function nodeDetail(data: NodeData, detailKey: string | undefined): string {
  const v = detailKey ? data[detailKey] : undefined;
  return typeof v === "string" ? v : "";
}

/**
 * The tree being edited, with ids on its nodes. `commit` saves a change and
 * reports it without ids; a new `value` from outside replaces the tree
 * unless it is the one last reported.
 */
function useTreeValue(
  value: unknown,
  key: string,
  onChange: (v: NodeData[]) => void,
) {
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
  return { tree, latest, commit };
}

/** Which nodes have their children hidden. */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
  return { collapsed, expand, toggle };
}

/**
 * Drag state: the rows to show (the dragged node's descendants travel with
 * it and are hidden), and where the dragged node would land, nested by how
 * far it has moved sideways.
 */
function useTreeDrag(
  tree: TreeNode[],
  collapsed: Set<string>,
  maxDepth: number,
) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const flat = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);
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
  return {
    sensors,
    visible,
    activeId,
    /** The depth to draw a row at: the dragged one at its projected depth. */
    depthOf: (item: FlatNode) =>
      activeId === item.id && projection ? projection.depth : item.depth,
    start: (id: string) => {
      setActiveId(id);
      setOverId(id);
    },
    move: setOffsetX,
    over: setOverId,
    /** Ends the drag, returning where the node would land. */
    end: () => {
      setActiveId(null);
      setOverId(null);
      setOffsetX(0);
      return projection;
    },
  };
}

/** What follows the pointer while dragging: the node's label and how many travel with it. */
function DragGhost({
  node,
  labelKey,
}: {
  node: TreeNode | null;
  labelKey: string;
}) {
  if (!node) return null;
  return (
    <div className="v-tree__item v-tree__ghost">
      <span className="v-list__handle">
        <GripVertical />
      </span>
      <span className="v-tree__label">{nodeLabel(node.data, labelKey)}</span>
      {node.children.length > 0 && (
        <span className="v-tree__count">+{descendantIds(node).length}</span>
      )}
    </div>
  );
}

type RowView = {
  label: string;
  detail: string;
  collapsed: boolean;
  editing: boolean;
  canAddChild: boolean;
  /** The tree is read-only, so its rows can't be dragged. */
  readOnly: boolean;
};

type RowActions = {
  onToggle: () => void;
  onEdit: () => void;
  onAddChild: () => void;
  onRemove: () => void;
};

function TreeRow({
  item,
  depth,
  view,
  actions,
  children,
}: {
  item: FlatNode;
  depth: number;
  view: RowView;
  actions: RowActions;
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
  } = useSortable({ id: item.id, disabled: view.readOnly });
  return (
    <div
      ref={setNodeRef}
      className={cx(
        "v-tree__row",
        isDragging && "is-placeholder",
        view.editing && "is-editing",
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
        <TreeToggle
          childCount={item.childCount}
          collapsed={view.collapsed}
          onToggle={actions.onToggle}
        />
        <button type="button" className="v-tree__text" onClick={actions.onEdit}>
          <span className="v-tree__label">{view.label}</span>
          {view.detail && <span className="v-tree__detail">{view.detail}</span>}
          {view.collapsed && item.childCount > 0 && (
            <span className="v-tree__count">{item.childCount}</span>
          )}
        </button>
        <RowButtons view={view} actions={actions} />
      </div>
      {children}
    </div>
  );
}

/** Shows or hides a node's children; a spacer for a node without any. */
function TreeToggle({
  childCount,
  collapsed,
  onToggle,
}: {
  childCount: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (childCount === 0) {
    return <span className="v-tree__toggle v-tree__toggle--leaf" />;
  }
  return (
    <button
      type="button"
      className="v-tree__toggle"
      onClick={onToggle}
      title={collapsed ? "Expand" : "Collapse"}
    >
      {collapsed ? <ChevronRight /> : <ChevronDown />}
    </button>
  );
}

function RowButtons({ view, actions }: { view: RowView; actions: RowActions }) {
  return (
    <div className="v-list__actions">
      {view.canAddChild && (
        <Button
          variant="ghost"
          size="xs"
          icon
          title="Add child"
          onClick={actions.onAddChild}
        >
          <CornerDownRight />
        </Button>
      )}
      <Button
        variant="ghost"
        size="xs"
        icon
        title={view.editing ? "Done" : "Edit"}
        onClick={actions.onEdit}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        icon
        title="Remove"
        onClick={actions.onRemove}
      >
        <Trash />
      </Button>
    </div>
  );
}

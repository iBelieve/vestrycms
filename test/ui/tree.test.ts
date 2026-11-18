import { describe, expect, it } from "vitest";
import {
  annotate,
  descendantIds,
  dropNode,
  findNode,
  flatten,
  getProjection,
  mapTree,
  strip,
  type TreeNode,
} from "../../src/ui/components/fields/tree.js";

const menu = [
  { title: "Home" },
  { title: "About", items: [{ title: "Team" }, { title: "History" }] },
  { title: "Contact" },
];

/** The tree's titles, nested like the stored value. */
const titles = (nodes: TreeNode[]): unknown[] =>
  nodes.map((n) =>
    n.children.length ? [n.data.title, titles(n.children)] : n.data.title,
  );
const id = (tree: TreeNode[], title: string) =>
  flatten(tree, new Set()).find((n) => n.data.title === title)!.id;

describe("the tree model", () => {
  it("gives stored nodes ids, and takes them away again", () => {
    const tree = annotate(menu, "items");
    expect(titles(tree)).toEqual([
      "Home",
      ["About", ["Team", "History"]],
      "Contact",
    ]);
    expect(strip(tree, "items")).toEqual(menu);
    expect(annotate("x", "items")).toEqual([]);
    expect(strip(annotate([null], "items"), "items")).toEqual([{}]);
  });

  it("flattens into rows, leaving out collapsed children", () => {
    const tree = annotate(menu, "items");
    const about = id(tree, "About");
    expect(
      flatten(tree, new Set()).map((n) => [
        n.data.title,
        n.depth,
        n.childCount,
      ]),
    ).toEqual([
      ["Home", 0, 0],
      ["About", 0, 2],
      ["Team", 1, 0],
      ["History", 1, 0],
      ["Contact", 0, 0],
    ]);
    expect(flatten(tree, new Set([about])).map((n) => n.data.title)).toEqual([
      "Home",
      "About",
      "Contact",
    ]);
    expect(descendantIds(findNode(tree, about)!)).toHaveLength(2);
    expect(findNode(tree, "nope")).toBeNull();
    expect(
      titles(
        mapTree(tree, (n) => ({ ...n, data: { title: `${n.data.title}!` } })),
      ),
    ).toEqual(["Home!", ["About!", ["Team!", "History!"]], "Contact!"]);
  });
});

describe("dragging", () => {
  const rows = (tree: TreeNode[]) => flatten(tree, new Set());

  it("nests a row under the one above when dragged to the right", () => {
    const tree = annotate(menu, "items");
    const contact = id(tree, "Contact");
    const projection = getProjection(rows(tree), contact, contact, 28, 99);
    expect(projection).toMatchObject({ depth: 1, parentId: id(tree, "About") });
    expect(titles(dropNode(tree, contact, projection)!)).toEqual([
      "Home",
      ["About", ["Team", "History", "Contact"]],
    ]);
  });

  it("lifts a row out of its parent when dragged to the left", () => {
    const tree = annotate(menu, "items");
    const history = id(tree, "History");
    const projection = getProjection(rows(tree), history, history, -28, 99);
    expect(projection).toMatchObject({ depth: 0, parentId: null });
    expect(titles(dropNode(tree, history, projection)!)).toEqual([
      "Home",
      ["About", ["Team"]],
      "History",
      "Contact",
    ]);
  });

  it("keeps the depth of the row it is dropped beside", () => {
    const tree = annotate(menu, "items");
    const home = id(tree, "Home");
    const team = id(tree, "Team");
    // Onto Team's place: beside Team, under About.
    const projection = getProjection(rows(tree), home, team, 0, 99);
    expect(projection).toMatchObject({ depth: 1, parentId: id(tree, "About") });
    expect(titles(dropNode(tree, home, projection)!)).toEqual([
      ["About", ["Team", "Home", "History"]],
      "Contact",
    ]);
  });

  it("finds the parent of a shallower depth further up", () => {
    const tree = annotate(
      [
        { title: "A", items: [{ title: "B", items: [{ title: "C" }] }] },
        { title: "D" },
      ],
      "items",
    );
    const d = id(tree, "D");
    const projection = getProjection(rows(tree), d, d, 28, 99);
    expect(projection).toMatchObject({ depth: 1, parentId: id(tree, "A") });
  });

  it("stops at the maximum depth", () => {
    const tree = annotate(menu, "items");
    const contact = id(tree, "Contact");
    expect(getProjection(rows(tree), contact, contact, 280, 1)).toMatchObject({
      depth: 0,
      parentId: null,
    });
  });

  it("drops nothing for an unknown row", () => {
    const tree = annotate(menu, "items");
    expect(
      getProjection(rows(tree), "nope", id(tree, "Home"), 0, 99),
    ).toBeNull();
    expect(
      getProjection(rows(tree), id(tree, "Home"), "nope", 0, 99),
    ).toBeNull();
    expect(dropNode(tree, "nope", null)).toBeNull();
  });
});

// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openPanel } from "./harness.js";
import { collection, defineConfig, fields } from "../../src/config/index.js";

const config = defineConfig({
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  collections: {
    menus: collection({
      label: "Menus",
      path: "src/content/menus/*.json",
      schema: {
        title: fields.text(),
        links: fields.tree({
          childrenKey: "items",
          maxDepth: 2,
          fields: { title: fields.text(), url: fields.text() },
        }),
      },
    }),
  },
});

const menu = [
  { title: "Home", url: "/" },
  { title: "About", items: [{ title: "Team" }, { title: "History" }] },
  { title: "Contact" },
];

// jsdom lays nothing out: stack the tree's rows 40px apart, so a drag can
// tell which row it is over. The dragged copy starts where its row is.
let ghostTop = 0;
const rect = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "getBoundingClientRect",
)!;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.closest(".v-tree__ghost"))
      return new DOMRect(0, ghostTop, 400, 40);
    const row = this.closest(".v-tree__row");
    if (!row) return new DOMRect(0, 0, 0, 0);
    const index = Array.from(row.parentElement!.children).indexOf(row);
    return new DOMRect(0, index * 40, 400, 40);
  };
});
afterAll(() =>
  Object.defineProperty(Element.prototype, "getBoundingClientRect", rect),
);

async function open(links: unknown = menu) {
  const result = await openPanel(config, {
    url: "/collections/menus/main",
    files: {
      "src/content/menus/main.json": JSON.stringify({ title: "Main", links }),
    },
  });
  await screen.findByDisplayValue("Main");
  return result;
}
const tree = () => document.querySelector(".v-tree") as HTMLElement;
const labels = () =>
  Array.from(tree().querySelectorAll(".v-tree__row")).map((r) => [
    r.querySelector(".v-tree__label")!.textContent,
    (r as HTMLElement).style.paddingLeft,
  ]);
const row = (label: string) =>
  within(tree())
    .getByText(label, { selector: ".v-tree__label" })
    .closest(".v-tree__row") as HTMLElement;
async function save(root: string) {
  await userEvent.click(screen.getByRole("button", { name: /^Save/ }));
  await waitFor(() =>
    expect(document.querySelector(".v-toasts")?.textContent).toBe(
      "Saved to disk",
    ),
  );
  return JSON.parse(
    await readFile(path.join(root, "src/content/menus/main.json"), "utf8"),
  ).links;
}

describe("the tree input", () => {
  it("adds, edits, folds and removes items", async () => {
    const user = userEvent.setup();
    const { root } = await open();
    expect(labels()).toEqual([
      ["Home", "0px"],
      ["About", "0px"],
      ["Team", "28px"],
      ["History", "28px"],
      ["Contact", "0px"],
    ]);
    expect(within(row("Home")).getByText("/")).toBeTruthy();
    // The deepest items can't have children.
    expect(within(row("Team")).queryByTitle("Add child")).toBeNull();

    await user.click(within(row("About")).getByTitle("Collapse"));
    expect(labels().map(([l]) => l)).toEqual(["Home", "About", "Contact"]);
    expect(within(row("About")).getByText("2")).toBeTruthy();
    await user.click(within(row("About")).getByTitle("Expand"));

    // A new item opens for editing.
    await user.click(within(tree()).getByRole("button", { name: /Add item/ }));
    expect(within(row("Untitled")).getByTitle("Done")).toBeTruthy();
    await user.type(within(row("Untitled")).getByLabelText("Title"), "Blog");
    await user.click(within(row("Blog")).getByTitle("Done"));
    expect(within(row("Blog")).queryByLabelText("Title")).toBeNull();

    // A child goes under its parent, which opens to show it.
    await user.click(within(row("About")).getByTitle("Collapse"));
    await user.click(within(row("About")).getByTitle("Add child"));
    await user.type(within(row("Untitled")).getByLabelText("Title"), "Jobs");
    await user.click(within(row("Home")).getByRole("button", { name: /Home/ }));
    expect(within(row("Home")).getByLabelText("Url")).toBeTruthy();

    // Removing the item being edited closes its form.
    await user.click(within(row("Home")).getByTitle("Remove"));
    await user.click(within(row("Contact")).getByTitle("Remove"));
    expect(await save(root)).toEqual([
      {
        title: "About",
        items: [{ title: "Team" }, { title: "History" }, { title: "Jobs" }],
      },
      { title: "Blog" },
    ]);
  });

  it("starts empty", async () => {
    await open("not a list");
    expect(within(tree()).getByText("No items yet.")).toBeTruthy();
  });

  it("nests an item dragged to the right", async () => {
    const { root } = await open();
    const handle = row("Contact").querySelector(".v-list__handle")!;
    ghostTop = 160;
    await act(async () => {
      fireEvent.pointerDown(handle, {
        clientX: 10,
        clientY: 170,
        button: 0,
        isPrimary: true,
      });
      fireEvent.pointerMove(document, { clientX: 20, clientY: 170 });
      fireEvent.pointerMove(document, { clientX: 40, clientY: 170 });
    });
    await waitFor(() =>
      expect(document.querySelector(".v-tree__ghost")).not.toBeNull(),
    );
    expect(
      within(document.querySelector(".v-tree__ghost") as HTMLElement).getByText(
        "Contact",
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.pointerUp(document, { clientX: 40, clientY: 170 });
    });
    // For a moment after a drop, dnd-kit swallows clicks.
    await new Promise((resolve) => setTimeout(resolve, 60));
    await waitFor(() =>
      expect(labels()).toEqual([
        ["Home", "0px"],
        ["About", "0px"],
        ["Team", "28px"],
        ["History", "28px"],
        ["Contact", "28px"],
      ]),
    );
    expect(await save(root)).toEqual([
      { title: "Home", url: "/" },
      {
        title: "About",
        items: [{ title: "Team" }, { title: "History" }, { title: "Contact" }],
      },
    ]);
  });

  it("drags a parent with its children, and can be cancelled", async () => {
    await open();
    const handle = row("About").querySelector(".v-list__handle")!;
    ghostTop = 40;
    await act(async () => {
      fireEvent.pointerDown(handle, {
        clientX: 10,
        clientY: 50,
        button: 0,
        isPrimary: true,
      });
      fireEvent.pointerMove(document, { clientX: 10, clientY: 60 });
    });
    await waitFor(() =>
      expect(document.querySelector(".v-tree__ghost")).not.toBeNull(),
    );
    expect(
      within(document.querySelector(".v-tree__ghost") as HTMLElement).getByText(
        "+2",
      ),
    ).toBeTruthy();
    expect(labels().map(([l]) => l)).toEqual(["Home", "About", "Contact"]);
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    });
    await waitFor(() => expect(labels()).toHaveLength(5));
  });
});

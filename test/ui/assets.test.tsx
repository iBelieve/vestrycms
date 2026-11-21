// @vitest-environment jsdom
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileList, openPanel, pickFiles } from "./harness.js";
import { defineConfig } from "../../src/config/index.js";

const config = defineConfig({
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  assets: {
    images: { label: "Images", directory: "public/images" },
    docs: { label: "Documents", directory: "src/docs", accept: ["pdf"] },
  },
});

const files = {
  "public/images/a.png": "a",
  "public/images/notes.txt": "n",
  "public/images/sub/b.png": "b",
};
const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

describe("the assets page", () => {
  // The chosen view is kept in localStorage.
  afterEach(() => localStorage.clear());

  it("browses folders and shows a file", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/assets/images", files });
    await user.click(await screen.findByRole("button", { name: /sub/ }));
    expect(await screen.findByText("b.png")).toBeTruthy();
    expect(screen.queryByText("a.png")).toBeNull();
    await user.click(screen.getByRole("button", { name: "sub" }));
    await user.click(screen.getByRole("button", { name: "public/images" }));
    await user.click(await screen.findByText("notes.txt"));
    let dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Done" }));

    await user.click(screen.getByText("a.png"));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("public/images/a.png")).toBeTruthy();
    expect(within(dialog).getByText("/images/a.png")).toBeTruthy();
    expect(within(dialog).getByText("1 B")).toBeTruthy();
    expect(dialog.querySelector("img")).not.toBeNull();
    await user.click(within(dialog).getByRole("button", { name: /Copy path/ }));
    expect(await navigator.clipboard.readText()).toBe("public/images/a.png");
    expect(await screen.findByText("Path copied")).toBeTruthy();
  });

  it("says when the path could not be copied", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/assets/images", files });
    await user.click(await screen.findByText("a.png"));
    const copy = within(screen.getByRole("dialog")).getByRole("button", {
      name: /Copy path/,
    });
    // Refused by the browser, and no clipboard at all (not a secure context).
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"))
      .mockImplementationOnce(() => {
        throw new TypeError("navigator.clipboard is undefined");
      });
    await user.click(copy);
    expect(await screen.findByText("Couldn't copy the path")).toBeTruthy();
    await user.click(copy);
    await waitFor(() =>
      expect(screen.getAllByText("Couldn't copy the path")).toHaveLength(2),
    );
    expect(write).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Path copied")).toBeNull();
  });

  it("uploads and deletes files", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, { url: "/assets/images", files });
    await screen.findByText("a.png");
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    pickFiles(input, new File(["c"], "c.png"));
    expect(await screen.findByText("Uploaded 1 file")).toBeTruthy();
    expect(await screen.findByText("c.png")).toBeTruthy();
    expect(await readFile(path.join(root, "public/images/c.png"), "utf8")).toBe(
      "c",
    );

    // Dropped files are uploaded too.
    const zone = screen.getByText(/Drop files here/);
    fireEvent.dragOver(zone);
    expect(zone.classList.contains("is-over")).toBe(true);
    fireEvent.dragLeave(zone);
    expect(zone.classList.contains("is-over")).toBe(false);
    fireEvent.drop(zone, { dataTransfer: { files: fileList() } });
    fireEvent.drop(zone, {
      dataTransfer: {
        files: fileList(new File(["d"], "d.png"), new File(["e"], "e.png")),
      },
    });
    expect(await screen.findByText("Uploaded 2 files")).toBeTruthy();
    await waitFor(async () =>
      expect(await exists(path.join(root, "public/images/e.png"))).toBe(true),
    );

    await user.click(await screen.findByText("a.png"));
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    const confirm = screen
      .getByText("Delete file?")
      .closest('[role="dialog"]') as HTMLElement;
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("File deleted")).toBeTruthy();
    expect(await exists(path.join(root, "public/images/a.png"))).toBe(false);
  });

  it("cancels a delete", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, { url: "/assets/images", files });
    await user.click(await screen.findByText("a.png"));
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Delete file?")).toBeNull();
    expect(await exists(path.join(root, "public/images/a.png"))).toBe(true);
  });

  it("reports a failed upload", async () => {
    await openPanel(config, { url: "/assets/docs", files });
    expect(await screen.findByText("No files here yet")).toBeTruthy();
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(input.accept).toBe(".pdf");
    pickFiles(input, new File(["x"], "x.exe"));
    expect(
      await screen.findByText(/"x.exe" is not an accepted file type/),
    ).toBeTruthy();
  });

  it("says when a folder does not exist", async () => {
    await openPanel(config, { url: "/assets/nope" });
    expect(
      await screen.findByText("No asset folder called “nope”"),
    ).toBeTruthy();
  });
});

describe("the assets list and search", () => {
  afterEach(() => localStorage.clear());

  const many = {
    "public/images/a.png": "a",
    "public/images/notes.txt": "nn",
    "public/images/sub/b.png": "b",
    "public/images/sub/deeper/b-final.png": "bbb",
    "public/images/.cache/b-hidden.png": "x",
    "src/docs/annual-report-2019-with-a-very-long-name.pdf": "pdf",
    "src/docs/2020/annual-report.pdf": "pdf2",
  };

  it("shows a list instead of tiles, and remembers it", async () => {
    const user = userEvent.setup();
    const { view } = await openPanel(config, {
      url: "/assets/images",
      files: many,
    });
    await screen.findByText("a.png");
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(screen.getByRole("button", { name: "List" }));
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "subFolder",
      "a.pngPNG1 B",
      "notes.txtTXT2 B",
    ]);
    expect(screen.getByText("2 files")).toBeTruthy();
    expect(localStorage.getItem("vestry:asset-view:images")).toBe('"list"');

    // Sorted by size, largest first.
    await user.click(within(table).getByRole("button", { name: "Size" }));
    await user.click(within(table).getByRole("button", { name: "Size" }));
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual(["subFolder", "notes.txtTXT2 B", "a.pngPNG1 B"]);

    // A name opens the file; a folder opens the folder.
    await user.click(within(table).getByRole("button", { name: /notes\.txt/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }),
    );
    await user.click(within(table).getByRole("button", { name: /sub/ }));
    expect(await screen.findByText("b.png")).toBeTruthy();

    view.unmount();
    await openPanel(config, { url: "/assets/images", files: many });
    await screen.findByText("a.png");
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("opens a documents folder as a list", async () => {
    await openPanel(config, { url: "/assets/docs", files: many });
    expect(
      await screen.findByText("annual-report-2019-with-a-very-long-name.pdf"),
    ).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("searches file names in this folder and the ones inside it", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/assets/images", files: many });
    await screen.findByText("a.png");
    const search = screen.getByRole("searchbox", { name: "Search files" });
    await user.type(search, "B");
    expect(await screen.findByText("b-final.png")).toBeTruthy();
    expect(screen.getByText("b.png")).toBeTruthy();
    expect(screen.queryByText("a.png")).toBeNull();
    // Folders give way to the matches, and hidden folders stay hidden.
    expect(screen.queryByRole("button", { name: /^sub$/ })).toBeNull();
    expect(screen.queryByText("b-hidden.png")).toBeNull();
    // Each match below this folder says where it is.
    expect(screen.getByText("sub/deeper · 3 B")).toBeTruthy();

    // Every word has to match, in the name or the folders on its path.
    await user.clear(search);
    await user.type(search, "deeper b");
    await waitFor(() => expect(screen.queryByText("b.png")).toBeNull());
    expect(screen.getByText("b-final.png")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByText("1 of 4 files")).toBeTruthy();
    expect(screen.getByText("sub/deeper/")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /b-final\.png/ }));
    expect(
      within(screen.getByRole("dialog")).getByText(
        "public/images/sub/deeper/b-final.png",
      ),
    ).toBeTruthy();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }),
    );

    await user.type(search, "zzz");
    expect(await screen.findByText("No matches")).toBeTruthy();
  });

  it("searches only below the folder shown", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/assets/images?dir=sub", files: many });
    await screen.findByText("b.png");
    await user.type(screen.getByRole("searchbox"), "png");
    expect(await screen.findByText("b-final.png")).toBeTruthy();
    expect(screen.getByText("deeper · 3 B")).toBeTruthy();
    expect(screen.queryByText("a.png")).toBeNull();
  });
});

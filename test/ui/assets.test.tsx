// @vitest-environment jsdom
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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

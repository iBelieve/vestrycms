// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openPanel } from "./harness.js";
import { collection, defineConfig, fields } from "../../src/config/index.js";

const config = defineConfig({
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  collections: {
    posts: collection({
      label: "Posts",
      path: "src/content/posts/*.md",
      schema: { title: fields.text(), date: fields.date() },
    }),
  },
});

describe("the dashboard", () => {
  it("lists the collections", async () => {
    await openPanel(config, {
      files: { "src/content/posts/a.md": "---\ntitle: A\n---\n" },
    });
    expect(await screen.findAllByText("Posts")).not.toHaveLength(0);
  });

  it("shows Vestry's mark beside the name when the site sets no logo", async () => {
    await openPanel(config);
    expect(await screen.findByText("Test Site")).toBeTruthy();
    expect(document.querySelector(".v-chrome__mark")).not.toBeNull();
  });

  it("shows the site's logo in place of Vestry's mark when one is set", async () => {
    await openPanel({ ...config, logo: "https://example.org/logo.svg" });
    expect(await screen.findByRole("img", { name: "Test Site" })).toBeTruthy();
    expect(document.querySelector(".v-chrome__mark")).toBeNull();
  });

  const recentConfig = defineConfig({
    name: "Test Site",
    repo: { owner: "o", name: "r", branch: "main" },
    collections: {
      posts: collection({
        label: "Posts",
        singular: "Post",
        path: "src/content/posts/*.md",
        sort: { field: "date", direction: "desc" },
        schema: { title: fields.text(), date: fields.date() },
      }),
      faqs: collection({
        label: "FAQs",
        singular: "FAQ",
        path: "src/content/faqs/*.md",
        sort: { field: "number", direction: "desc" },
        columns: ["number", "title", "date"],
        recent: true,
        schema: {
          number: fields.number(),
          title: fields.text(),
          date: fields.date(),
        },
      }),
      events: collection({
        label: "Events",
        path: "src/content/events/*.md",
        sort: { field: "date", direction: "desc" },
        schema: { title: fields.text(), date: fields.date() },
      }),
      days: collection({
        label: "Days",
        path: "src/content/days/*.md",
        sort: { field: "date", direction: "desc" },
        readOnly: true,
        schema: { title: fields.text(), date: fields.date() },
      }),
    },
  });
  const recentFiles = {
    "src/content/posts/a.md": "---\ntitle: Post A\ndate: 2026-01-05\n---\n",
    "src/content/faqs/one.md":
      "---\nnumber: 1\ntitle: First question\ndate: 2025-03-01\n---\n",
    "src/content/faqs/two.md":
      "---\nnumber: 2\ntitle: Second question\ndate: 2026-02-10\n---\n",
    // The highest number, but not the newest.
    "src/content/faqs/three.md":
      "---\nnumber: 3\ntitle: Third question\ndate: 2024-06-01\n---\n",
    "src/content/days/d.md": "---\ntitle: Day D\ndate: 2026-01-01\n---\n",
  };

  const recentSection = async (title: string) =>
    (await screen.findByRole("heading", { name: title })).closest(
      "section",
    ) as HTMLElement;

  it("puts a New button in the top bar for each recent list it can create in", async () => {
    await openPanel(recentConfig, { files: recentFiles });
    await recentSection("Recent days");
    const bar = document.querySelector(".v-topbar") as HTMLElement;
    const links = within(bar).getAllByRole("link");
    expect(
      links.map((a) => [a.textContent?.trim(), a.getAttribute("href")]),
    ).toEqual([
      ["New Post", "/admin/collections/posts/new"],
      ["New FAQ", "/admin/collections/faqs/new"],
      // No `singular`: named by its label, not "New entry".
      ["New Events", "/admin/collections/events/new"],
    ]);
  });

  it("lists a collection sorted by number newest first by its date column", async () => {
    await openPanel(recentConfig, { files: recentFiles });
    const faqs = await recentSection("Recent FAQs");
    const titles = within(faqs)
      .getAllByRole("link")
      .map((a) => a.textContent)
      .filter((t) => t?.endsWith("question"));
    expect(titles).toEqual([
      "Second question",
      "First question",
      "Third question",
    ]);
    expect(within(faqs).getAllByRole("row")[0].textContent).toMatch(/2026/);
  });
});

// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openPanel } from "./harness.js";
import { collection, defineConfig, fields } from "../../src/config/index.js";

const config = defineConfig({
  name: "Test Site",
  siteUrl: "https://example.org",
  repo: { owner: "o", name: "r", branch: "main" },
  collections: {
    posts: collection({
      label: "Posts",
      singular: "Post",
      path: "src/content/posts/*.md",
      previewUrl: "/posts/{slug}",
      status: { field: "draft", publishedWhen: false },
      searchFields: ["topic"],
      columns: [
        "date",
        { field: "slug", label: "File" },
        "status",
        "featured",
        "kind",
        "cover",
        "author",
        "tags",
        "meta",
        "topic",
        "extra",
        "missing",
      ],
      schema: {
        title: fields.text(),
        draft: fields.boolean(),
        date: fields.date(),
        featured: fields.boolean(),
        kind: fields.select({
          options: [
            { label: "News", value: "news", color: "#00f" },
            { label: "Note", value: "note" },
          ],
        }),
        cover: fields.image({ directory: "public/images" }),
        author: fields.reference({ collection: "people" }),
        tags: fields.array(fields.text()),
        meta: fields.object({ a: fields.text() }),
        topic: fields.text({ label: "Subject" }),
      },
    }),
    people: collection({
      label: "People",
      path: "src/content/people/*.md",
      create: false,
      status: { field: "draft" },
      schema: { title: fields.text(), draft: fields.boolean() },
    }),
    notes: collection({
      label: "Notes",
      path: "src/content/notes/*.md",
      schema: { title: fields.text() },
    }),
  },
});

const files = {
  "src/content/posts/b-first.md": [
    "---",
    "title: Beta",
    "subtitle: The second letter",
    "draft: true",
    "date: 2026-01-02",
    "featured: true",
    "kind: news",
    "cover: /images/b.png",
    "author: ann",
    "tags: [x, y]",
    "meta: { a: b }",
    "topic: greek",
    "extra: 7",
    "---",
    "",
  ].join("\n"),
  "src/content/posts/a-second.md": [
    "---",
    "title: Alpha",
    "date: 2026-01-01",
    "featured: false",
    "kind: other",
    "author: gone",
    "---",
    "",
    "The body of alpha.",
    "",
  ].join("\n"),
  "src/content/people/ann.md": "---\ntitle: Ann\n---\n",
};

const titles = () =>
  screen
    .getAllByRole("link")
    .filter((a) => a.classList.contains("v-table__title"))
    .map((a) => a.textContent);

describe("a collection's list", () => {
  it("shows, searches, filters and sorts its entries", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/posts", files });
    await screen.findByText("Beta");
    expect(screen.getByRole("link", { name: /New Post/ })).toBeTruthy();
    expect(screen.getByText("2 of 2 posts")).toBeTruthy();

    // The columns: their labels, and each type of value.
    const head = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(head).toEqual([
      "Title",
      "Date",
      "File",
      "Status",
      "Featured",
      "Kind",
      "Cover",
      "Author",
      "Tags",
      "Meta",
      "Subject",
      "Extra",
      "Missing",
      "",
    ]);
    const beta = screen.getByText("Beta").closest("tr")!;
    expect(within(beta).getByText("The second letter")).toBeTruthy();
    expect(within(beta).getByText("Yes")).toBeTruthy();
    expect(within(beta).getByText("News")).toBeTruthy();
    expect(beta.querySelector(".v-swatch")).not.toBeNull();
    expect(beta.querySelector("img.v-thumb")).not.toBeNull();
    expect(await within(beta).findByText("Ann")).toBeTruthy();
    expect(within(beta).getByText("2 items")).toBeTruthy();
    expect(within(beta).getByText("…")).toBeTruthy();
    expect(within(beta).getByText("7")).toBeTruthy();
    expect(within(beta).getByText("b-first")).toBeTruthy();
    expect(within(beta).getByTitle("View on site").getAttribute("href")).toBe(
      "https://example.org/posts/b-first",
    );
    const alpha = screen.getByText("Alpha").closest("tr")!;
    expect(within(alpha).getByText("The body of alpha.")).toBeTruthy();
    expect(within(alpha).getByText("No")).toBeTruthy();
    expect(within(alpha).getByText("other")).toBeTruthy();
    expect(within(alpha).getByText("gone")).toBeTruthy();
    expect(within(alpha).getAllByText("—").length).toBeGreaterThan(0);

    // Search by title, slug or a search field.
    const search = screen.getByPlaceholderText("Search posts…");
    await user.type(search, "alp");
    expect(titles()).toEqual(["Alpha"]);
    await user.clear(search);
    await user.type(search, "first");
    expect(titles()).toEqual(["Beta"]);
    await user.clear(search);
    await user.type(search, "greek");
    expect(titles()).toEqual(["Beta"]);
    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.getByText("No matches")).toBeTruthy();
    expect(screen.queryByText(/Create the first/)).toBeNull();
    await user.clear(search);

    // Filter by status.
    await user.click(screen.getByRole("button", { name: "Draft" }));
    expect(titles()).toEqual(["Beta"]);
    await user.click(screen.getByRole("button", { name: "Published" }));
    expect(titles()).toEqual(["Alpha"]);
    await user.click(screen.getByRole("button", { name: "All" }));

    // Sort by a column, then the other way.
    await user.click(screen.getByRole("button", { name: "Title" }));
    expect(titles()).toEqual(["Alpha", "Beta"]);
    await user.click(screen.getByRole("button", { name: "Title" }));
    expect(titles()).toEqual(["Beta", "Alpha"]);
    await user.click(screen.getByRole("button", { name: "File" }));
    expect(titles()).toEqual(["Alpha", "Beta"]);
    await user.click(screen.getByRole("button", { name: "Date" }));
    expect(titles()).toEqual(["Alpha", "Beta"]);
    await user.click(screen.getByRole("button", { name: "Date" }));
    expect(titles()).toEqual(["Beta", "Alpha"]);
    await user.click(screen.getByRole("button", { name: "Extra" }));
    expect(titles()).toEqual(["Alpha", "Beta"]);
  });

  it("shows a status column of its own, and no new button where creating is off", async () => {
    await openPanel(config, { url: "/collections/people", files });
    await screen.findByText("Ann");
    expect(screen.queryByRole("link", { name: /New/ })).toBeNull();
    expect(screen.queryByTitle("View on site")).toBeNull();
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual(["Title", "Status", ""]);
    expect(screen.getByText("Published")).toBeTruthy();
  });

  it("invites the first entry of an empty collection", async () => {
    await openPanel(config, { url: "/collections/notes" });
    expect(await screen.findByText("No notes yet")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Create the first entry/ }),
    ).toBeTruthy();
  });

  it("says when a collection does not exist", async () => {
    await openPanel(config, { url: "/collections/nope" });
    expect(await screen.findByText("No collection called “nope”")).toBeTruthy();
  });
});

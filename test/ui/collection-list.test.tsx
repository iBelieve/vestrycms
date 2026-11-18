// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { openPanel } from "./harness.js";
import { collection, defineConfig, fields } from "../../src/config/index.js";
import { formatDate } from "../../src/ui/lib/utils.js";

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
        "editors",
        "links",
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
        editors: fields.array(fields.reference({ collection: "people" })),
        links: fields.array(fields.object({ url: fields.text() })),
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
    faqs: collection({
      label: "FAQs",
      path: "src/content/faqs/*.md",
      columns: ["number", { field: "title", label: "Question" }, "title"],
      schema: { number: fields.number(), title: fields.text() },
    }),
    pages: collection({
      label: "Pages",
      path: "src/content/pages/**.md",
      tree: true,
      sort: { field: "title", direction: "asc" },
      status: { field: "draft", publishedWhen: false },
      schema: { title: fields.text(), draft: fields.boolean() },
    }),
    readings: collection({
      label: "Readings",
      path: "src/content/readings/**.md",
      tree: "only",
      schema: { title: fields.text() },
    }),
    authors: collection({
      label: "Authors",
      path: "src/content/authors.yaml",
      titleField: "name",
      sort: { field: "name", direction: "asc" },
      schema: {
        id: fields.slug({ from: "name" }),
        name: fields.text(),
      },
    }),
    staff: collection({
      label: "Staff",
      path: "src/content/staff/*.md",
      titleField: "name",
      columns: ["name", "title", "roles", "days", "photos", "flags"],
      schema: {
        name: fields.text({ label: "Full name" }),
        title: fields.text({ label: "Job title" }),
        roles: fields.multiselect({
          options: [
            { label: "Elder", value: "elder" },
            { label: "Usher", value: "usher" },
          ],
        }),
        days: fields.array(fields.date()),
        photos: fields.array(fields.image({ directory: "public/images" })),
        flags: fields.array(fields.boolean()),
      },
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
    "editors: [ann, gone]",
    "links: [{ url: a }]",
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
  "src/content/faqs/why.md": "---\nnumber: 29\ntitle: Why?\n---\n\nBecause.\n",
  "src/content/staff/ann.md": [
    "---",
    "name: Ann",
    "title: Zookeeper",
    "roles: [usher, elder]",
    'days: ["2026-01-02", ""]',
    "photos: [/images/a.png]",
    "flags: [true, false]",
    "---",
    "",
  ].join("\n"),
  "src/content/pages/about.md": "---\ntitle: About\n---\n",
  "src/content/pages/resources.md": "---\ntitle: Resources\n---\n",
  "src/content/pages/resources/music.md":
    "---\ntitle: Resources - Music\ndraft: true\n---\n",
  "src/content/pages/guides/one.md": "---\ntitle: Guide one\n---\n",
  "src/content/readings/cw.md": "---\ntitle: CW\n---\n",
  "src/content/readings/cw/advent.md": '---\ntitle: "CW: Advent"\n---\n',
  "src/content/authors.yaml": "- id: ann\n  name: Ann Smith\n",
  "src/content/staff/bob.md": "---\nname: Bob\ntitle: Accountant\n---\n",
};

const titles = () =>
  screen
    .getAllByRole("link")
    .filter((a) => a.classList.contains("v-table__title"))
    .map((a) => a.textContent);

describe("a collection's list", () => {
  // The list's view and expanded rows are kept in localStorage.
  afterEach(() => localStorage.clear());

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
      "Editors",
      "Links",
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
    expect(within(beta).getByText("x, y")).toBeTruthy();
    await waitFor(() =>
      expect(beta.cells[head.indexOf("Editors")].textContent).toBe("Ann, gone"),
    );
    expect(within(beta).getByText("1 item")).toBeTruthy();
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
    // The status column sorts by the status it shows (drafts first).
    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(titles()).toEqual(["Beta", "Alpha"]);
    await user.click(screen.getByRole("button", { name: "Status" }));
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

  it("places the title where its columns list it, once", async () => {
    await openPanel(config, { url: "/collections/faqs", files });
    await screen.findByText("Why?");
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual(["Number", "Question", ""]);
    const cells = screen.getByText("Why?").closest("tr")!.cells;
    expect(cells[0].textContent).toBe("29");
    expect(cells[1].className).toBe("v-table__main");
    expect(cells[1].textContent).toBe("Why?Because.");
    expect(screen.getAllByText("Why?")).toHaveLength(1);
  });

  it("labels and sorts a title field of another name, and lists values", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/staff", files });
    await screen.findByText("Ann");
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual([
      "Full name",
      "Job title",
      "Roles",
      "Days",
      "Photos",
      "Flags",
      "",
    ]);
    const cells = screen.getByText("Ann").closest("tr")!.cells;
    expect([...cells].slice(1, 6).map((c) => c.textContent)).toEqual([
      "Zookeeper",
      "Usher, Elder",
      formatDate("2026-01-02"),
      "a.png",
      "Yes, No",
    ]);

    // The job title sorts by itself, not by the name.
    await user.click(screen.getByRole("button", { name: "Job title" }));
    expect(titles()).toEqual(["Bob", "Ann"]);
    await user.click(screen.getByRole("button", { name: "Full name" }));
    expect(titles()).toEqual(["Ann", "Bob"]);
    await user.click(screen.getByRole("button", { name: "Full name" }));
    expect(titles()).toEqual(["Bob", "Ann"]);
  });

  it("shows a title field that is also the sort field once", async () => {
    await openPanel(config, { url: "/collections/authors", files });
    await screen.findByText("Ann Smith");
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual(["Name", ""]);
    expect(screen.getAllByText("Ann Smith")).toHaveLength(1);
  });

  it("nests entries by folder, and lists them flat on request", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/pages", files });
    await screen.findByText("Resources");
    // Only the top level shows at first, with how much each folder holds.
    expect(titles()).toEqual(["About", "Resources"]);
    expect(screen.getByText("guides")).toBeTruthy();
    expect(screen.getAllByText("· 1")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Expand Resources" }));
    expect(titles()).toEqual(["About", "Resources", "Music"]);
    expect(screen.getByText("Music").getAttribute("title")).toBe(
      "Resources - Music",
    );
    await user.click(screen.getByRole("button", { name: "Expand guides" }));
    expect(titles()).toEqual(["About", "Guide one", "Resources", "Music"]);
    await user.click(
      screen.getByRole("button", { name: "Collapse Resources" }),
    );
    expect(titles()).toEqual(["About", "Guide one", "Resources"]);

    // A filter lists its matches flat, under their full titles.
    await user.click(screen.getByRole("button", { name: "Draft" }));
    expect(titles()).toEqual(["Resources - Music"]);
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.type(screen.getByPlaceholderText("Search pages…"), "guide");
    expect(titles()).toEqual(["Guide one"]);
    await user.clear(screen.getByPlaceholderText("Search pages…"));

    // The list view, which is remembered.
    await user.click(screen.getByRole("button", { name: "List" }));
    expect(titles()).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /Expand/ })).toBeNull();
    expect(localStorage.getItem("vestry:list-view:pages")).toBe('"list"');
    await user.click(screen.getByRole("button", { name: "Tree" }));
    expect(titles()).toEqual(["About", "Guide one", "Resources"]);
    expect(JSON.parse(localStorage.getItem("vestry:tree-open:pages")!)).toEqual(
      ["guides"],
    );
  });

  it("shows a tree with no toggle when the tree is the only view", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/readings", files });
    await screen.findByText("CW");
    expect(screen.queryByRole("button", { name: "List" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Expand CW" }));
    expect(titles()).toEqual(["CW", "Advent"]);
  });

  it.each(["{nope", "{}", "null", '"cw"', "[1]"])(
    "falls back to the defaults when storage holds %s",
    async (garbage) => {
      const user = userEvent.setup();
      localStorage.setItem("vestry:tree-open:pages", garbage);
      localStorage.setItem("vestry:list-view:pages", garbage);
      await openPanel(config, { url: "/collections/pages", files });
      await screen.findByText("Resources");
      expect(titles()).toEqual(["About", "Resources"]);
      await user.click(
        screen.getByRole("button", { name: "Expand Resources" }),
      );
      expect(titles()).toEqual(["About", "Resources", "Music"]);
    },
  );

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

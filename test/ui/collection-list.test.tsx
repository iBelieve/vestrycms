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
      fixedEntries: true,
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
    site: collection({
      label: "Site pages",
      path: "src/content/site/**.md",
      tree: true,
      sort: { field: "title", direction: "asc" },
      pinned: [
        { slug: "index", icon: "house" },
        { slug: "404", icon: "file-question-mark" },
        "docs/start",
        "nope",
      ],
      schema: { title: fields.text() },
    }),
    home: collection({
      label: "Home pages",
      path: "src/pages/*.md",
      schema: { title: fields.text() },
    }),
    manual: collection({
      label: "Manual",
      path: "src/content/manual/**.md",
      tree: "only",
      sort: { field: "title", direction: "asc" },
      pinned: ["guide"],
      schema: { title: fields.text() },
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
  "src/content/faqs/how.md": "---\nnumber: 9\ntitle: How?\n---\n",
  "src/content/faqs/what.md": "---\ntitle: What?\n---\n",
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
  "src/content/site/404.md": "---\ntitle: Not found\n---\n",
  "src/content/site/about.md": "---\ntitle: About\n---\n",
  "src/content/site/docs.md": "---\ntitle: Docs\n---\n",
  "src/content/site/docs/faq.md": "---\ntitle: FAQ\n---\n",
  "src/content/site/docs/start.md": "---\ntitle: Start here\n---\n",
  "src/content/site/index.md": "---\ntitle: Welcome\n---\n",
  "src/pages/500.md": "---\ntitle: Server error\n---\n",
  "src/pages/Index.md": "---\ntitle: Welcome\n---\n",
  "src/pages/about.md": "---\ntitle: About\n---\n",
  "src/content/manual/about.md": "---\ntitle: About\n---\n",
  "src/content/manual/guide.md": "---\ntitle: Guide\n---\n",
  "src/content/manual/guide/one.md": '---\ntitle: "Guide: One"\n---\n',
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
    // Local files are `astro dev`: links go to its server, not the live site.
    expect(within(beta).getByTitle("View on site").getAttribute("href")).toBe(
      `${window.location.origin}/posts/b-first`,
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
    // Alpha has no extra, so it comes last either way.
    await user.click(screen.getByRole("button", { name: "Extra" }));
    expect(titles()).toEqual(["Beta", "Alpha"]);
    // The status column sorts by the status it shows (drafts first).
    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(titles()).toEqual(["Beta", "Alpha"]);
    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(titles()).toEqual(["Alpha", "Beta"]);
    // Neither has a value for "missing", so they go by title, as on the
    // server (which lists them Beta first, by slug).
    await user.click(screen.getByRole("button", { name: "Missing" }));
    expect(titles()).toEqual(["Alpha", "Beta"]);
    await user.click(screen.getByRole("button", { name: "Missing" }));
    expect(titles()).toEqual(["Alpha", "Beta"]);
  });

  it("names yes/no columns beside their values, for phones", async () => {
    await openPanel(config, { url: "/collections/posts", files });
    await screen.findByText("Beta");
    const labelled = [...document.querySelectorAll("td[data-label]")];
    expect(
      new Set(labelled.map((td) => td.getAttribute("data-label"))),
    ).toEqual(new Set(["Featured"]));
    expect(
      labelled.every(
        (td) => td.textContent === "Yes" || td.textContent === "No",
      ),
    ).toBe(true);
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

  it("sorts a column as the server does: numbers as numbers, missing last", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/faqs", files });
    await screen.findByText("Why?");
    const questions = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map(
          (r) =>
            /^\w+\?/.exec(
              (r as HTMLTableRowElement).cells[1].textContent ?? "",
            )?.[0],
        );
    await user.click(screen.getByRole("button", { name: "Number" }));
    expect(questions()).toEqual(["How?", "Why?", "What?"]);
    await user.click(screen.getByRole("button", { name: "Number" }));
    expect(questions()).toEqual(["Why?", "How?", "What?"]);
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
    // Each row carries its depth, which indents its facts under the title
    // on phones.
    const depth = (title: string) =>
      screen
        .getByText(title)
        .closest("tr")!
        .style.getPropertyValue("--v-depth");
    expect(depth("CW")).toBe("0");
    expect(depth("Advent")).toBe("1");
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

  it("lists pinned entries first, in their own order, above a band", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/site", files });
    await screen.findByText("Welcome");
    const divider = () => document.querySelector(".v-table__divider");
    const icons = () =>
      [...document.querySelectorAll(".v-table__pin-icon")].map((icon) => [
        icon.parentElement?.textContent,
        icon.classList.contains("lucide-house") ? "house" : "other",
      ]);
    // In `pinned` order, not by title, with their icons, then a band, then
    // the tree, which no longer holds the pinned entry under Docs.
    expect(titles()).toEqual([
      "Welcome",
      "Not found",
      "Start here",
      "About",
      "Docs",
    ]);
    expect(divider()).toBeTruthy();
    expect(screen.getByText("docs/start")).toBeTruthy();
    expect(icons()).toEqual([
      ["Welcome", "house"],
      ["Not found", "other"],
    ]);
    expect(screen.getByText("· 1")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Expand Docs" }));
    expect(titles()).toEqual([
      "Welcome",
      "Not found",
      "Start here",
      "About",
      "Docs",
      "FAQ",
    ]);

    // A sort reorders only the rest, and the list view pins them too,
    // without the slug, since no entry there sits in a folder.
    await user.click(screen.getByRole("button", { name: "List" }));
    expect(screen.queryByText("docs/start")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Title" }));
    await user.click(screen.getByRole("button", { name: /Title/ }));
    expect(titles()).toEqual([
      "Welcome",
      "Not found",
      "Start here",
      "FAQ",
      "Docs",
      "About",
    ]);

    // A search keeps the split, and drops the band when one side is empty.
    const search = screen.getByPlaceholderText("Search site pages…");
    await user.type(search, "ou");
    expect(titles()).toEqual(["Not found", "About"]);
    expect(divider()).toBeTruthy();
    await user.clear(search);
    await user.type(search, "wel");
    expect(titles()).toEqual(["Welcome"]);
    expect(divider()).toBeNull();
    await user.clear(search);
    await user.type(search, "faq");
    expect(titles()).toEqual(["FAQ"]);
    expect(divider()).toBeNull();
  });

  it("pins the home and error pages by default, ignoring case", async () => {
    await openPanel(config, { url: "/collections/home", files });
    await screen.findByText("Welcome");
    expect(titles()).toEqual(["Welcome", "Server error", "About"]);
    expect(
      [...document.querySelectorAll(".v-table__pin-icon")].map((icon) =>
        [...icon.classList].find((c) => c.startsWith("lucide-")),
      ),
    ).toEqual(["lucide-house", "lucide-triangle-exclamation-point"]);
    expect(document.querySelector(".v-table__divider")).toBeTruthy();
  });

  it("keeps a pinned entry with children in the tree, to head its folder", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/manual", files });
    await screen.findByText("About");
    expect(titles()).toEqual(["Guide", "About", "Guide"]);
    await user.click(screen.getByRole("button", { name: "Expand Guide" }));
    expect(titles()).toEqual(["Guide", "About", "Guide", "One"]);
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

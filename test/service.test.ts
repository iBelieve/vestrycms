/** ContentService against the local source, in a temporary project directory. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collection, defineConfig, fields } from "../src/config/index.js";
import { ContentService } from "../src/core/service.js";
import { LocalSource } from "../src/core/sources/local.js";

const config = defineConfig({
  repo: { owner: "o", name: "r" },
  collections: {
    articles: collection({
      label: "Articles",
      path: "src/content/articles/**.mdx",
      slug: { template: "{date|year}/{date|month}/{title}" },
      previewUrl: "/articles/{slug}",
      sort: { field: "date", direction: "desc" },
      schema: {
        title: fields.text({ required: true }),
        date: fields.date(),
      },
    }),
    notes: collection({
      label: "Notes",
      path: "src/content/notes/*.md",
      schema: { title: fields.text() },
    }),
    links: collection({
      label: "Links",
      path: "src/data/links.yaml",
      schema: { id: fields.text(), title: fields.text() },
    }),
  },
});

let root: string;
let service: ContentService;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vestry-service-"));
  service = new ContentService(config, new LocalSource(root), {
    builtAt: "",
    files: {},
  });
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("entries with nested slugs", () => {
  it("creates an entry at the path its slug template gives", async () => {
    const saved = await service.saveEntry("articles", null, {
      data: { title: "My Title", date: "2026-11-13" },
      body: "Hello.\n",
    });
    expect(saved.slug).toBe("2026/11/my-title");
    expect(saved.path).toBe("src/content/articles/2026/11/my-title.mdx");
    const text = await readFile(path.join(root, saved.path), "utf8");
    expect(text).toContain("title: My Title\n");
    expect(text.endsWith("---\n\nHello.\n")).toBe(true);
  });

  it("refuses a second entry with the same slug", async () => {
    await expect(
      service.saveEntry("articles", null, {
        data: { title: "My title!", date: "2026-11-30" },
      }),
    ).rejects.toMatchObject({ status: 409, code: "exists" });
  });

  it("reads, lists and updates it by that slug", async () => {
    const entry = await service.getEntry("articles", "2026/11/my-title");
    expect(entry).toMatchObject({
      slug: "2026/11/my-title",
      title: "My Title",
      data: { title: "My Title", date: "2026-11-13" },
      body: "Hello.\n",
    });

    await service.saveEntry("articles", null, {
      data: { title: "Older", date: "2025-02-03" },
    });
    const entries = await service.listEntries("articles");
    expect(entries.map((e) => e.slug)).toEqual([
      "2026/11/my-title",
      "2025/02/older",
    ]);

    // Changing the date leaves the entry where it is.
    const updated = await service.saveEntry("articles", "2026/11/my-title", {
      data: { title: "My Title", date: "2026-12-01" },
      body: "Changed.\n",
      sha: entry!.sha,
    });
    expect(updated.path).toBe("src/content/articles/2026/11/my-title.mdx");
    expect((await service.getEntry("articles", "2026/11/my-title"))?.body).toBe(
      "Changed.\n",
    );
  });

  it("takes a slug the editor sends over the template", async () => {
    const saved = await service.saveEntry("articles", null, {
      data: { title: "Elsewhere", date: "2026-11-13" },
      slug: "archive/elsewhere",
    });
    expect(saved.path).toBe("src/content/articles/archive/elsewhere.mdx");
  });

  it("rejects a slug with an empty segment, as a blank date leaves", async () => {
    await expect(
      service.saveEntry("articles", null, { data: { title: "No date" } }),
    ).rejects.toMatchObject({ status: 400, code: "bad_slug" });
  });

  it("deletes it", async () => {
    await service.deleteEntry("articles", "2025/02/older");
    expect(await service.getEntry("articles", "2025/02/older")).toBe(null);
  });

  it("rejects a nested slug where the path has a single-level wildcard", async () => {
    await expect(
      service.saveEntry("notes", null, {
        data: { title: "Note" },
        slug: "2026/note",
      }),
    ).rejects.toMatchObject({ status: 400, code: "bad_slug" });
    expect(
      (await service.saveEntry("notes", null, { data: { title: "Note" } }))
        .path,
    ).toBe("src/content/notes/note.md");
  });
});

describe("renaming an entry", () => {
  it("moves its file", async () => {
    await service.saveEntry("notes", null, { data: { title: "Draft" } });
    const { sha } = (await service.getEntry("notes", "draft"))!;
    const saved = await service.saveEntry("notes", "draft", {
      data: { title: "Draft" },
      slug: "final",
      sha,
    });
    expect(saved.path).toBe("src/content/notes/final.md");
    expect(await service.getEntry("notes", "draft")).toBe(null);
  });

  it("refuses to move it onto another entry", async () => {
    await expect(
      service.saveEntry("notes", "final", {
        data: { title: "Final" },
        slug: "note",
      }),
    ).rejects.toMatchObject({ status: 409, code: "exists" });
  });

  it("refuses when its file is gone", async () => {
    await expect(
      service.saveEntry("notes", "missing", {
        data: { title: "Missing" },
        slug: "found",
      }),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
  });

  it("refuses a save over a newer version", async () => {
    await expect(
      service.saveEntry("notes", "final", {
        data: { title: "Final" },
        sha: "0".repeat(40),
      }),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
  });

  it("refuses a save over an entry deleted since it was opened", async () => {
    await service.saveEntry("notes", null, { data: { title: "Brief" } });
    const { sha } = (await service.getEntry("notes", "brief"))!;
    await service.deleteEntry("notes", "brief");
    await expect(
      service.saveEntry("notes", "brief", { data: { title: "Brief" }, sha }),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
    expect(await service.getEntry("notes", "brief")).toBe(null);
  });

  it("refuses an unsafe current slug", async () => {
    await expect(
      service.saveEntry("notes", "../final", {
        data: { title: "Final" },
        slug: "moved",
      }),
    ).rejects.toMatchObject({ status: 400, code: "bad_slug" });
  });
});

describe("fixed and reserved slugs", () => {
  const fixedConfig = defineConfig({
    repo: { owner: "o", name: "r" },
    collections: {
      pages: collection({
        label: "Pages",
        path: "src/pages/*.mdx",
        reservedSlugs: ["index", "404", "sermons"],
        schema: { title: fields.text() },
      }),
      fixed: collection({
        label: "Fixed",
        path: "src/fixed/*.md",
        editable: false,
        schema: { title: fields.text() },
      }),
      docs: collection({
        label: "Docs",
        path: "src/docs/**.md",
        reservedSlugs: ["sermons", "sermons/archive"],
        schema: { title: fields.text() },
      }),
      menus: collection({
        label: "Menus",
        path: "src/data/menus.yaml",
        reservedSlugs: ["main", "footer"],
        schema: { id: fields.text(), title: fields.text() },
      }),
    },
  });
  let fixedRoot: string;
  let pages: ContentService;

  beforeAll(async () => {
    fixedRoot = await mkdtemp(path.join(tmpdir(), "vestry-fixed-"));
    for (const [file, text] of Object.entries({
      "src/pages/index.mdx": "---\ntitle: Home\n---\n",
      "src/pages/about.mdx": "---\ntitle: About\n---\n",
      "src/fixed/one.md": "---\ntitle: One\n---\n",
      "src/docs/guide.md": "---\ntitle: Guide\n---\n",
      "src/docs/sermons/old.md": "---\ntitle: Old\n---\n",
      "src/data/menus.yaml": "- id: main\n  title: Main\n",
    })) {
      await mkdir(path.dirname(path.join(fixedRoot, file)), {
        recursive: true,
      });
      await writeFile(path.join(fixedRoot, file), text);
    }
    pages = new ContentService(fixedConfig, new LocalSource(fixedRoot), {
      builtAt: "",
      files: {},
    });
  });

  afterAll(() => rm(fixedRoot, { recursive: true, force: true }));

  it("keeps a reserved entry from being renamed or deleted", async () => {
    await expect(
      pages.saveEntry("pages", "index", {
        data: { title: "Home" },
        slug: "home",
      }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(pages.deleteEntry("pages", "index")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(await pages.getEntry("pages", "index")).not.toBe(null);
  });

  it("still saves a reserved entry in place", async () => {
    const saved = await pages.saveEntry("pages", "index", {
      data: { title: "Welcome" },
    });
    expect(saved.slug).toBe("index");
  });

  it("refuses a reserved slug to a new or renamed entry", async () => {
    await expect(
      pages.saveEntry("pages", null, {
        data: { title: "Sermons" },
        slug: "sermons",
      }),
    ).rejects.toMatchObject({ status: 409, code: "exists" });
    await expect(
      pages.saveEntry("pages", "about", {
        data: { title: "About" },
        slug: "404",
      }),
    ).rejects.toMatchObject({ status: 409, code: "exists" });
    expect(await pages.getEntry("pages", "about")).not.toBe(null);
  });

  it("refuses to rename a list entry with a reserved id", async () => {
    await expect(
      pages.saveEntry("menus", "main", { data: { id: "top", title: "Main" } }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(
      pages.saveEntry("menus", null, { data: { id: "main", title: "Again" } }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      pages.saveEntry("menus", null, { data: { id: "footer", title: "F" } }),
    ).rejects.toMatchObject({ status: 409, code: "exists" });
  });

  it("refuses a reserved slug in any letter case", async () => {
    await expect(
      pages.saveEntry("pages", null, {
        data: { title: "Sermons" },
        slug: "Sermons",
      }),
    ).rejects.toMatchObject({ status: 409, code: "exists" });
    await expect(pages.deleteEntry("pages", "INDEX")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("treats a save under a slug with no entry as creating it", async () => {
    await expect(
      pages.saveEntry("pages", "sermons", { data: { title: "Sermons" } }),
    ).rejects.toMatchObject({ status: 409, code: "exists" });
    await expect(
      pages.saveEntry("menus", "footer", {
        data: { id: "footer", title: "F" },
      }),
    ).rejects.toMatchObject({ status: 409, code: "exists" });
    await expect(
      pages.saveEntry("fixed", "two", { data: { title: "Two" } }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(await pages.getEntry("pages", "sermons")).toBe(null);
    expect(await pages.getEntry("fixed", "two")).toBe(null);
    expect(await pages.getEntry("menus", "footer")).toBe(null);
  });

  it("refuses to create, rename or delete entries of a collection that isn't editable", async () => {
    await expect(
      pages.saveEntry("fixed", null, { data: { title: "Two" } }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(
      pages.saveEntry("fixed", "one", { data: { title: "One" }, slug: "uno" }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(pages.deleteEntry("fixed", "one")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    const saved = await pages.saveEntry("fixed", "one", {
      data: { title: "Uno" },
    });
    expect(saved.slug).toBe("one");
  });

  it("refuses new or renamed entries under a reserved slug", async () => {
    await expect(
      pages.saveEntry("docs", null, {
        data: { title: "Index" },
        slug: "Sermons/index",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "exists",
      message: '"Sermons/index" is under the reserved slug "sermons"',
    });
    await expect(
      pages.saveEntry("docs", "guide", {
        data: { title: "Guide" },
        slug: "sermons/page/2",
      }),
    ).rejects.toMatchObject({ status: 409, code: "exists" });
    // A slug that only begins with the reserved one is someone else's.
    const saved = await pages.saveEntry("docs", null, {
      data: { title: "Series" },
      slug: "sermons-series/one",
    });
    expect(saved.slug).toBe("sermons-series/one");
  });

  it("names the reserved slug itself before one it is under", async () => {
    await expect(
      pages.saveEntry("docs", null, {
        data: { title: "Archive" },
        slug: "sermons/archive",
      }),
    ).rejects.toMatchObject({
      message: '"sermons/archive" is a reserved slug',
    });
  });

  it("still edits and deletes an entry already under a reserved slug", async () => {
    const saved = await pages.saveEntry("docs", "sermons/old", {
      data: { title: "Older" },
    });
    expect(saved.slug).toBe("sermons/old");
    await pages.deleteEntry("docs", "sermons/old");
    expect(await pages.getEntry("docs", "sermons/old")).toBe(null);
  });

  it("looks under a reserved slug only where the collection has folders", async () => {
    // A list's ids are not paths.
    const saved = await pages.saveEntry("menus", null, {
      data: { id: "main/extra", title: "Extra" },
    });
    expect(saved.slug).toBe("main/extra");
    // A flat collection refuses the slash itself.
    await expect(
      pages.saveEntry("pages", null, {
        data: { title: "Index" },
        slug: "sermons/index",
      }),
    ).rejects.toMatchObject({ status: 400, code: "bad_slug" });
  });
});

describe("sorting", () => {
  const sortConfig = defineConfig({
    repo: { owner: "o", name: "r" },
    collections: {
      pages: collection({
        label: "Pages",
        path: "src/pages/**.md",
        sort: { field: "order", direction: "asc" },
        schema: { title: fields.text(), order: fields.number() },
      }),
    },
  });
  let sortRoot: string;

  beforeAll(async () => {
    sortRoot = await mkdtemp(path.join(tmpdir(), "vestry-sort-"));
  });

  afterAll(() => rm(sortRoot, { recursive: true, force: true }));

  it("puts entries without a value last, and ties in title order", async () => {
    const pages = new ContentService(sortConfig, new LocalSource(sortRoot), {
      builtAt: "",
      files: {},
    });
    for (const [slug, title, order] of [
      ["zeta", "Zeta", undefined],
      ["about", "About", undefined],
      ["second", "Second", 2],
      ["first-b", "First B", 1],
      ["first-a", "First A", 1],
    ] as const)
      await pages.saveEntry("pages", null, { data: { title, order }, slug });
    const entries = await pages.listEntries("pages");
    expect(entries.map((e) => e.slug)).toEqual([
      "first-a",
      "first-b",
      "second",
      "about",
      "zeta",
    ]);
    // Missing values stay last when the order is reversed too.
    const reversed = new ContentService(
      defineConfig({
        ...sortConfig,
        collections: {
          pages: {
            ...sortConfig.collections!.pages,
            sort: { field: "order", direction: "desc" },
          },
        },
      }),
      new LocalSource(sortRoot),
      { builtAt: "", files: {} },
    );
    expect((await reversed.listEntries("pages")).map((e) => e.slug)).toEqual([
      "second",
      "first-a",
      "first-b",
      "about",
      "zeta",
    ]);
  });
});

describe("entries kept as a list in one file", () => {
  const file = () => readFile(path.join(root, "src/data/links.yaml"), "utf8");

  it("adds an entry, with its id from the given field or its title", async () => {
    const first = await service.saveEntry("links", null, {
      data: { title: "Home Page" },
    });
    expect(first).toMatchObject({
      slug: "home-page",
      path: "src/data/links.yaml",
    });
    await service.saveEntry("links", null, {
      data: { id: "about", title: "About" },
    });
    expect(await file()).toBe(
      "- title: Home Page\n  id: home-page\n- id: about\n  title: About\n",
    );
  });

  it("updates an entry in place", async () => {
    const saved = await service.saveEntry("links", "about", {
      data: { id: "about", title: "About us" },
    });
    expect(saved.slug).toBe("about");
    expect(await file()).toContain("title: About us");
    expect((await service.listEntries("links")).map((e) => e.slug)).toEqual([
      "home-page",
      "about",
    ]);
  });

  it("refuses a second entry with the same id", async () => {
    await expect(
      service.saveEntry("links", null, { data: { id: "about" } }),
    ).rejects.toMatchObject({ status: 409, code: "exists" });
  });

  it("refuses to change an entry's id to another's", async () => {
    await expect(
      service.saveEntry("links", "about", {
        data: { id: "home-page", title: "About" },
      }),
    ).rejects.toMatchObject({ status: 409, code: "exists" });
  });

  it("refuses an entry without an id", async () => {
    await expect(
      service.saveEntry("links", null, { data: { id: "" } }),
    ).rejects.toMatchObject({ status: 400, code: "validation" });
  });

  it("refuses a save over a newer version of the file", async () => {
    await expect(
      service.saveEntry("links", "about", {
        data: { id: "about" },
        sha: "0".repeat(40),
      }),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
  });
});

describe("renaming a list entry", () => {
  const listConfig = defineConfig({
    repo: { owner: "o", name: "r" },
    collections: {
      places: collection({
        label: "Places",
        path: "src/data/places.yaml",
        schema: {
          id: fields.text(),
          title: fields.text(),
          near: fields.array(fields.reference({ collection: "places" })),
          checked: fields.datetime({ autoUpdate: true, storage: "local" }),
        },
      }),
      trips: collection({
        label: "Trips",
        path: "src/content/trips/*.md",
        schema: {
          title: fields.text(),
          to: fields.reference({ collection: "places" }),
        },
      }),
      steps: collection({
        label: "Steps",
        path: "src/data/steps.json",
        schema: {
          id: fields.number(),
          next: fields.reference({ collection: "steps" }),
        },
      }),
      routes: collection({
        label: "Routes",
        path: "src/data/routes.json",
        schema: {
          id: fields.text(),
          stops: fields.array(fields.reference({ collection: "places" })),
        },
      }),
    },
  });
  // The control panel's stamp in a time zone six hours behind UTC.
  const evening = new Date(Date.now() - 6 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
  let listRoot: string;
  let places: ContentService;
  const read = (file: string) => readFile(path.join(listRoot, file), "utf8");

  beforeAll(async () => {
    listRoot = await mkdtemp(path.join(tmpdir(), "vestry-list-"));
    places = new ContentService(listConfig, new LocalSource(listRoot), {
      builtAt: "",
      files: {},
    });
    await places.saveEntry("places", null, {
      data: { id: "rome", title: "Rome", checked: evening },
    });
    await places.saveEntry("places", null, {
      data: { id: "ostia", title: "Ostia", near: ["rome"] },
    });
    await places.saveEntry("trips", null, {
      data: { title: "Spring", to: "rome" },
    });
    await places.saveEntry("routes", null, {
      data: { id: "coast", stops: ["ostia", "rome"] },
    });
  });
  afterAll(() => rm(listRoot, { recursive: true, force: true }));

  it("keeps the wall-clock time the editor stamped", async () => {
    // The editor's own time, which the server in UTC cannot know, is kept.
    expect(await read("src/data/places.yaml")).toContain(
      `checked: ${evening}\n`,
    );
  });

  it("finds the entries that refer to it", async () => {
    const refs = await places.referencesTo("places", "rome");
    expect(refs.map((r) => `${r.key}:${r.slug}`).sort()).toEqual([
      "places:ostia",
      "routes:coast",
      "trips:spring",
    ]);
  });

  it("repoints them when its id changes", async () => {
    const saved = await places.saveEntry("places", "rome", {
      data: { id: "roma", title: "Roma", checked: evening },
    });
    expect(saved.slug).toBe("roma");
    const list = await read("src/data/places.yaml");
    expect(list).toContain("id: roma");
    expect(list).not.toContain("rome");
    expect(list).toMatch(/near:\n\s+- roma/);
    expect(await read("src/content/trips/spring.md")).toContain("to: roma");
    expect(JSON.parse(await read("src/data/routes.json"))).toEqual([
      { id: "coast", stops: ["ostia", "roma"] },
    ]);
    expect(await places.referencesTo("places", "rome")).toEqual([]);
  });

  it("repoints references to a number id", async () => {
    await mkdir(path.join(listRoot, "src/data"), { recursive: true });
    await writeFile(
      path.join(listRoot, "src/data/steps.json"),
      JSON.stringify([{ id: 1 }, { id: 2, next: 1 }]),
    );
    expect(
      (await places.referencesTo("steps", "1")).map((r) => r.slug),
    ).toEqual(["2"]);
    await places.saveEntry("steps", "1", { data: { id: 3 } });
    // Numbers they were, and numbers they stay.
    expect(JSON.parse(await read("src/data/steps.json"))).toEqual([
      { id: 3 },
      { id: 2, next: 3 },
    ]);
    await places.saveEntry("steps", "3", { data: { id: "first" } });
    expect(JSON.parse(await read("src/data/steps.json"))).toEqual([
      { id: "first" },
      { id: 2, next: "first" },
    ]);
  });

  it("leaves references alone when its id stays", async () => {
    await places.saveEntry("places", "ostia", {
      data: { id: "ostia", title: "Ostia Antica", near: ["roma"] },
    });
    expect(await read("src/content/trips/spring.md")).toContain("to: roma");
  });
});

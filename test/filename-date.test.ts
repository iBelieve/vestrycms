/**
 * Entries whose date lives in the file name (`storeIn: "filename"`), and
 * renaming an entry on save, against a LocalSource in a temporary directory.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  collection,
  defineConfig,
  fields,
  singleton,
} from "../src/config/index.js";
import { ContentService } from "../src/core/service.js";
import { LocalSource } from "../src/core/sources/local.js";
import {
  dateFromSlug,
  slugWithDate,
  toStoredValues,
} from "../src/core/values.js";

const config = defineConfig({
  repo: { owner: "o", name: "r" },
  collections: {
    posts: collection({
      label: "Posts",
      path: "content/posts/*.md",
      slug: { template: "{date}-{title}" },
      sort: { field: "date", direction: "desc" },
      schema: {
        title: fields.text({ required: true }),
        date: fields.date({ storeIn: "filename" }),
      },
    }),
    notes: collection({
      label: "Notes",
      path: "content/notes/*.md",
      schema: { title: fields.text() },
    }),
    // Collections and a singleton that refer to notes, in each storage shape.
    essays: collection({
      label: "Essays",
      path: "content/essays/*.md",
      schema: {
        title: fields.text(),
        note: fields.reference({ collection: "notes" }),
        related: fields.array(fields.reference({ collection: "notes" })),
      },
    }),
    links: collection({
      label: "Links",
      path: "content/links.yaml",
      body: false,
      schema: {
        id: fields.slug(),
        target: fields.object({
          note: fields.reference({ collection: "notes" }),
        }),
      },
    }),
  },
  singletons: {
    site: singleton({
      label: "Site",
      path: "content/site.json",
      body: false,
      schema: { featured: fields.reference({ collection: "notes" }) },
    }),
  },
});

let root: string;
let service: ContentService;
const posts = () => readdirSync(join(root, "content/posts")).sort();
const read = (path: string) => readFileSync(join(root, path), "utf8");

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "vestry-"));
  mkdirSync(join(root, "content/posts"), { recursive: true });
  mkdirSync(join(root, "content/notes"), { recursive: true });
  writeFileSync(
    join(root, "content/posts/2020-01-05-first.md"),
    "---\ntitle: First\n---\n\nHello.\n",
  );
  writeFileSync(
    join(root, "content/posts/2021-06-30-second.md"),
    "---\ntitle: Second\n---\n",
  );
  writeFileSync(join(root, "content/notes/a.md"), "---\ntitle: A\n---\n");
  service = new ContentService(config, new LocalSource(root), {
    builtAt: "",
    files: {},
  });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("slug dates", () => {
  it("reads the date a slug starts with", () => {
    expect(dateFromSlug("2020-01-05-first")).toBe("2020-01-05");
    expect(dateFromSlug("blog/2020-01-05-first")).toBe("2020-01-05");
    expect(dateFromSlug("first")).toBeNull();
    expect(dateFromSlug("2020-01-05")).toBeNull();
  });

  it("sets or replaces the date prefix", () => {
    expect(slugWithDate("2020-01-05-first", "2022-03-04")).toBe(
      "2022-03-04-first",
    );
    expect(slugWithDate("first", "2022-03-04")).toBe("2022-03-04-first");
    expect(slugWithDate("blog/first", "2022-03-04")).toBe(
      "blog/2022-03-04-first",
    );
    expect(slugWithDate("first", "")).toBe("first");
    expect(slugWithDate("first", "2022-03-04T09:00")).toBe("first");
  });

  it("is not written to the file", () => {
    const schema = config.collections!.posts!.schema;
    expect(
      toStoredValues(schema, { title: "T", date: "2020-01-05" }, "x.md"),
    ).toEqual({ title: "T" });
  });
});

describe("file-name dates in the service", () => {
  it("fills the date from the file name and sorts by it", async () => {
    const entries = await service.listEntries("posts");
    expect(entries.map((e) => [e.slug, e.data.date])).toEqual([
      ["2021-06-30-second", "2021-06-30"],
      ["2020-01-05-first", "2020-01-05"],
    ]);
    const entry = await service.getEntry("posts", "2020-01-05-first");
    expect(entry?.data).toEqual({ title: "First", date: "2020-01-05" });
  });

  it("saves without renaming when the date is unchanged", async () => {
    const entry = (await service.getEntry("posts", "2020-01-05-first"))!;
    const saved = await service.saveEntry("posts", entry.slug, {
      data: { ...entry.data, title: "First!" },
      body: entry.body,
      sha: entry.sha,
    });
    expect(saved.slug).toBe("2020-01-05-first");
    expect(read("content/posts/2020-01-05-first.md")).toBe(
      "---\ntitle: First!\n---\n\nHello.\n",
    );
  });

  it("renames the file when the date changes", async () => {
    const entry = (await service.getEntry("posts", "2020-01-05-first"))!;
    const saved = await service.saveEntry("posts", entry.slug, {
      data: { ...entry.data, date: "2020-02-01" },
      body: entry.body,
      sha: entry.sha,
    });
    expect(saved.slug).toBe("2020-02-01-first");
    expect(saved.path).toBe("content/posts/2020-02-01-first.md");
    expect(posts()).toEqual(["2020-02-01-first.md", "2021-06-30-second.md"]);
    expect(read(saved.path)).not.toContain("date:");
    expect(await service.getEntry("posts", "2020-01-05-first")).toBeNull();
  });

  it("puts the date in a new entry's file name", async () => {
    const saved = await service.saveEntry("posts", null, {
      data: { title: "Third Post", date: "2022-12-25" },
      body: "",
    });
    expect(saved.slug).toBe("2022-12-25-third-post");
    expect(read(saved.path)).toBe("---\ntitle: Third Post\n---\n");
  });

  it("refuses a date that would overwrite another entry", async () => {
    writeFileSync(
      join(root, "content/posts/2021-06-30-first.md"),
      "---\ntitle: Clash\n---\n",
    );
    const entry = (await service.getEntry("posts", "2020-02-01-first"))!;
    await expect(
      service.saveEntry("posts", entry.slug, {
        data: { ...entry.data, date: "2021-06-30" },
        body: entry.body,
        sha: entry.sha,
      }),
    ).rejects.toMatchObject({ status: 409, code: "exists" });
    expect(posts()).toContain("2020-02-01-first.md");
  });
});

describe("renaming an entry", () => {
  it("moves the file when a different slug is given", async () => {
    const entry = (await service.getEntry("notes", "a"))!;
    const saved = await service.saveEntry("notes", "a", {
      data: entry.data,
      body: entry.body,
      sha: entry.sha,
      slug: "b",
    });
    expect(saved.slug).toBe("b");
    expect(readdirSync(join(root, "content/notes"))).toEqual(["b.md"]);
  });

  it("keeps the date prefix when a dated entry is renamed", async () => {
    const entry = (await service.getEntry("posts", "2021-06-30-second"))!;
    const saved = await service.saveEntry("posts", entry.slug, {
      data: entry.data,
      body: entry.body,
      sha: entry.sha,
      slug: "2021-06-30-two",
    });
    expect(saved.slug).toBe("2021-06-30-two");
  });

  it("rejects an unsafe slug and an existing one", async () => {
    const entry = (await service.getEntry("notes", "b"))!;
    const input = { data: entry.data, body: entry.body, sha: entry.sha };
    await expect(
      service.saveEntry("notes", "b", { ...input, slug: "../x" }),
    ).rejects.toMatchObject({ code: "bad_slug" });
    writeFileSync(join(root, "content/notes/c.md"), "---\ntitle: C\n---\n");
    await expect(
      service.saveEntry("notes", "b", { ...input, slug: "c" }),
    ).rejects.toMatchObject({ code: "exists" });
  });
});

describe("references to a renamed entry", () => {
  beforeAll(() => {
    mkdirSync(join(root, "content/essays"), { recursive: true });
    writeFileSync(join(root, "content/notes/ref.md"), "---\ntitle: Ref\n---\n");
    writeFileSync(
      join(root, "content/essays/one.md"),
      "---\ntitle: One\nnote: ref\nrelated:\n  - c\n  - ref\n---\n\nBody stays.\n",
    );
    writeFileSync(
      join(root, "content/essays/two.md"),
      "---\ntitle: Two\nnote: c\n---\n",
    );
    writeFileSync(
      join(root, "content/links.yaml"),
      "- id: x\n  target:\n    note: ref\n- id: y\n  target:\n    note: c\n",
    );
    writeFileSync(join(root, "content/site.json"), '{ "featured": "ref" }\n');
  });

  it("finds every entry and singleton that refers to it", async () => {
    const found = await service.referencesTo("notes", "ref");
    expect(found.map((r) => `${r.kind}:${r.key}:${r.slug}`).sort()).toEqual([
      "collection:essays:one",
      "collection:links:x",
      "singleton:site:site",
    ]);
    expect(await service.referencesTo("notes", "unused")).toEqual([]);
  });

  it("repoints them in the same commit as the rename", async () => {
    const entry = (await service.getEntry("notes", "ref"))!;
    await service.saveEntry("notes", "ref", {
      data: entry.data,
      body: entry.body,
      sha: entry.sha,
      slug: "renamed",
    });

    expect(read("content/essays/one.md")).toBe(
      "---\ntitle: One\nnote: renamed\nrelated:\n  - c\n  - renamed\n---\n\nBody stays.\n",
    );
    // Entries that refer to other notes are left alone.
    expect(read("content/essays/two.md")).toBe(
      "---\ntitle: Two\nnote: c\n---\n",
    );
    expect(read("content/links.yaml")).toContain("note: renamed");
    expect(read("content/links.yaml")).toContain("note: c");
    expect(JSON.parse(read("content/site.json"))).toEqual({
      featured: "renamed",
    });
    expect(await service.referencesTo("notes", "ref")).toEqual([]);
  });
});

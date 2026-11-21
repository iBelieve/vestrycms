import { describe, expect, it } from "vitest";
import {
  collection,
  defineConfig,
  fields,
  singleton,
} from "../../src/config/index.js";
import { parsePathPattern } from "../../src/core/paths.js";
import {
  bodyEnv,
  entryDisplay,
  entryFile,
  pagePath,
  publishToggle,
  readOnlySchema,
  slugBox,
  slugHint,
} from "../../src/ui/pages/entry-editing.js";

const config = defineConfig({
  name: "Test",
  repo: { owner: "o", name: "r", branch: "main" },
  components: {
    Note: { label: "Note", props: {} },
  },
  textStyles: { red: { label: "Red", class: "red" } },
});

const fileUrl = (path: string) => `/files/${path}`;
const upload = {
  path: "public/new.png",
  base64: "",
  previewUrl: "blob:new",
  size: 1,
};

describe("bodyEnv", () => {
  it("resolves images next to the entry without an images setting", () => {
    const env = bodyEnv({
      body: { components: ["Note", "Missing"] },
      filePath: "src/content/posts/a.mdx",
      config,
      uploads: { [upload.path]: upload },
      fileUrl,
    });
    expect(Object.keys(env.components)).toEqual(["Note"]);
    expect(env.textStyles).toBe(config.textStyles);
    expect(env.imageDirectory).toBeUndefined();
    expect(env.toRepoPath("https://example.org/a.png")).toBeNull();
    expect(env.toRepoPath("/new.png")).toBe("public/new.png");
    expect(env.toRepoPath("./img/b.png")).toBe("src/content/posts/img/b.png");
    expect(env.toRepoPath("b.png")).toBeNull();
    expect(env.toDocPath("src/content/posts/img/b.png")).toBe("./img/b.png");
    expect(env.resolveImage!("/new.png")).toBe("blob:new");
    expect(env.resolveImage!("./b.png")).toBe("/files/src/content/posts/b.png");
    expect(env.resolveImage!("b.png")).toBe("b.png");
  });

  it("follows the body's images setting", () => {
    const env = bodyEnv({
      body: { images: { directory: "public/images", storeAs: "public" } },
      filePath: "src/content/posts/a.mdx",
      config,
      uploads: {},
      fileUrl,
    });
    expect(env.components).toEqual({});
    expect(env.imageDirectory).toBe("public/images");
    expect(env.toRepoPath("/images/a.png")).toBe("public/images/a.png");
    expect(env.toDocPath("public/images/a.png")).toBe("/images/a.png");
    expect(env.resolveImage!("http://x/a.png")).toBe("http://x/a.png");
  });

  it("works without a body", () => {
    const env = bodyEnv({
      body: null,
      filePath: "a.md",
      config: defineConfig({ ...config, components: undefined }),
      uploads: {},
      fileUrl,
    });
    expect(env.components).toEqual({});
  });
});

describe("the entry's file", () => {
  const posts = collection({
    label: "Posts",
    path: "src/content/posts/*.md",
    schema: {},
  });
  const site = singleton({
    label: "Site",
    path: "./src/data/site.json",
    schema: {},
  });
  const pages = collection({
    label: "Pages",
    path: "src/data/pages.json",
    schema: {},
  });

  it("is the slug's file, a global's file or the one file of a collection", () => {
    const pattern = parsePathPattern(posts.path);
    expect(entryFile("collection", posts, pattern, "a")).toBe(
      "src/content/posts/a.md",
    );
    expect(entryFile("collection", posts, pattern, "")).toBe(
      "src/content/posts/new-entry.md",
    );
    expect(entryFile("singleton", site, parsePathPattern(site.path), "")).toBe(
      "src/data/site.json",
    );
    expect(
      entryFile("collection", pages, parsePathPattern(pages.path), "a"),
    ).toBe("src/data/pages.json");
  });

  it("names the file under the slug box for a new or renamed entry", () => {
    const pattern = parsePathPattern(posts.path);
    const saved = { slug: "a", data: {} };
    const hint = (slug: string, isNew: boolean, renaming: boolean) =>
      slugHint({
        collection: posts,
        pattern,
        slug,
        data: {},
        saved: isNew ? null : saved,
        renaming,
      });
    expect(hint("a", true, false)).toEqual({
      lead: null,
      path: "src/content/posts/a.md",
    });
    expect(hint("", true, false)?.path).toBe("src/content/posts/….md");
    expect(hint("b", false, true)).toEqual({
      lead: "Renames the file to",
      path: "src/content/posts/b.md",
    });
    expect(hint("a", false, false)).toBeNull();
    expect(
      slugHint({
        collection: pages,
        pattern: parsePathPattern(pages.path),
        slug: "a",
        data: {},
        saved: null,
        renaming: false,
      }),
    ).toBeNull();
  });

  it("says where the page moves when an edit changes its address", () => {
    const articles = collection({
      label: "Articles",
      path: "src/content/articles/*.mdx",
      previewUrl: "/articles/{slug|year}/{slug|month}/{slug|nodate}",
      schema: { date: fields.date({ storeIn: "filename" }) },
    });
    const pattern = parsePathPattern(articles.path);
    const saved = { slug: "2026-10-29-a-title", data: {} };
    const hint = (slug: string, renaming: boolean) =>
      slugHint({
        collection: articles,
        pattern,
        slug,
        data: {},
        saved,
        renaming,
      });
    // Nothing to say until an edit moves the page.
    expect(hint("2026-10-29-a-title", false)).toBeNull();
    expect(hint("2026-11-02-a-title", true)).toEqual({
      lead: "Moves to",
      path: "/articles/2026/11/a-title",
    });
    // The day isn't in the address, so only the file moves.
    expect(hint("2026-10-30-a-title", true)).toEqual({
      lead: "Renames the file to",
      path: "src/content/articles/2026-10-30-a-title.mdx",
    });
    // A new entry's address is under its title instead.
    expect(
      slugHint({
        collection: articles,
        pattern,
        slug: "2026-11-21-",
        data: {},
        saved: null,
        renaming: false,
      }),
    ).toBeNull();
  });

  it("fills a page's path, with an ellipsis for a name not yet given", () => {
    const articles = collection({
      label: "Articles",
      path: "src/content/articles/*.mdx",
      previewUrl: "/articles/{slug|year}/{slug|month}/{slug|nodate}",
      schema: {},
    });
    expect(pagePath(articles, "2026-10-29-a-title", {})).toBe(
      "/articles/2026/10/a-title",
    );
    expect(pagePath(articles, "2026-11-21-", {})).toBe("/articles/2026/11/…");
    expect(pagePath(posts, "a", {})).toBeNull();
  });

  it("holds the slug without a date set by the date field", () => {
    expect(slugBox("2026-11-17-a", "", "date")).toBe("a");
    expect(slugBox("2026-11-17-a", "", null)).toBe("2026-11-17-a");
    expect(slugBox("2026-11-17-x/y", "x/y", "date")).toBe("x/y");
  });
});

describe("entryDisplay", () => {
  const posts = collection({
    label: "Posts",
    path: "src/content/posts/*.md",
    previewUrl: "/posts/{slug}",
    status: { field: "draft", publishedWhen: false },
    schema: { title: fields.text(), draft: fields.boolean() },
  });

  it("shows a collection entry's title, status and preview", () => {
    const display = entryDisplay({
      kind: "collection",
      col: posts,
      data: { title: "Hi", draft: true },
      isNew: false,
      slug: "hi",
      saved: { slug: "hi", data: { title: "Hi", draft: true } },
      siteUrl: "https://example.org",
    });
    expect(display).toMatchObject({
      titleInput: "title",
      titleValue: "Hi",
      statusField: "draft",
      isPublished: false,
      previewHref: "https://example.org/posts/hi",
      address: {
        text: "example.org/posts/hi",
        href: "https://example.org/posts/hi",
      },
    });
    expect(display.editable("title")).toBe(false);
    expect(display.editable("draft")).toBe(false);
    expect(display.editable("body")).toBe(true);
  });

  it("names a global by its label, with no status or title field", () => {
    const site = singleton({
      label: "Site",
      path: "site.json",
      previewUrl: "/",
      schema: { title: fields.text() },
    });
    const display = entryDisplay({
      kind: "singleton",
      col: site,
      data: {},
      isNew: false,
      slug: "",
      saved: { slug: "", data: {} },
      siteUrl: undefined,
    });
    expect(display).toMatchObject({
      address: null,
      titleInput: null,
      titleValue: "Site",
      statusField: null,
      isPublished: null,
      previewHref: "/",
    });
    expect(display.editable("title")).toBe(true);
  });

  it("has no preview for a new entry, nor a title box for a non-text title", () => {
    const display = entryDisplay({
      kind: "collection",
      col: collection({
        label: "Years",
        path: "years/*.json",
        titleField: "year",
        previewUrl: "/{slug}",
        schema: { year: fields.number() },
      }),
      data: {},
      isNew: true,
      slug: "",
      saved: null,
      siteUrl: undefined,
    });
    expect(display.titleInput).toBeNull();
    expect(display.titleValue).toBe("");
    expect(display.previewHref).toBeNull();
    // Where it will be, not yet a link.
    expect(display.address).toEqual({ text: "/…", href: null });
  });

  it("links the page as saved until an edit to its slug is saved", () => {
    const display = entryDisplay({
      kind: "collection",
      col: posts,
      data: { title: "Hi" },
      isNew: false,
      slug: "hello",
      saved: { slug: "hi", data: { title: "Hi" } },
      siteUrl: "https://example.org/",
    });
    expect(display.previewHref).toBe("https://example.org/posts/hi");
    expect(display.address?.text).toBe("example.org/posts/hi");
  });
});

describe("publishToggle", () => {
  it("sets the status field to its published value, or not", () => {
    let data: Record<string, unknown> = { title: "a" };
    const toggle = publishToggle(
      { statusField: "draft", publishedWhen: false },
      data,
      (d) => (data = d),
    )!;
    toggle(true);
    expect(data).toEqual({ title: "a", draft: false });
    toggle(false);
    expect(data).toEqual({ title: "a", draft: true });
    expect(
      publishToggle({ statusField: null, publishedWhen: true }, {}, () => {}),
    ).toBeNull();
  });
});

describe("readOnlySchema", () => {
  it("makes every field read-only, nested ones included", () => {
    const schema = readOnlySchema({
      title: fields.text(),
      days: fields.array(
        fields.object({
          name: fields.text(),
          readings: fields.array(fields.reference({ collection: "x" })),
        }),
      ),
      menu: fields.tree({ fields: { label: fields.text() } }),
    });
    expect(schema).toMatchObject({
      title: { readOnly: true },
      days: {
        readOnly: true,
        of: {
          readOnly: true,
          fields: {
            name: { readOnly: true },
            readings: { readOnly: true, of: { readOnly: true } },
          },
        },
      },
      menu: { readOnly: true, fields: { label: { readOnly: true } } },
    });
  });
});

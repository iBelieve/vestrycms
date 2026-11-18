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
  publishToggle,
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

  it("is named under the slug box for a new or renamed entry", () => {
    const pattern = parsePathPattern(posts.path);
    expect(slugHint(pattern, "a", true, false)).toBe("src/content/posts/a.md");
    expect(slugHint(pattern, "", true, false)).toBe("src/content/posts/….md");
    expect(slugHint(pattern, "b", false, true)).toBe(
      "Renames the file to src/content/posts/b.md",
    );
    expect(slugHint(pattern, "a", false, false)).toBeNull();
    expect(slugHint(parsePathPattern(pages.path), "a", true, false)).toBeNull();
  });

  it("shows a date prefix in front of the slug box", () => {
    expect(slugBox("2026-11-17-a", "", "date")).toEqual({
      value: "a",
      prefix: "2026-11-17-",
    });
    expect(slugBox("a", "", null)).toEqual({ value: "a", prefix: "" });
    expect(slugBox("2026-11-17-x/y", "x/y", "date")).toEqual({
      value: "x/y",
      prefix: "",
    });
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
      siteUrl: "https://example.org",
    });
    expect(display).toMatchObject({
      titleInput: "title",
      titleValue: "Hi",
      statusField: "draft",
      isPublished: false,
      previewHref: "https://example.org/posts/hi",
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
      siteUrl: undefined,
    });
    expect(display).toMatchObject({
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
      siteUrl: undefined,
    });
    expect(display.titleInput).toBeNull();
    expect(display.titleValue).toBe("");
    expect(display.previewHref).toBeNull();
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

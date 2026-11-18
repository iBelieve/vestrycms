/** Template placeholders for slugs, preview URLs and commit messages. */
import { describe, expect, it } from "vitest";
import vestry from "../src/index.js";
import {
  entryPath,
  fillTemplate,
  isSafeSlug,
  parsePathPattern,
  relativePath,
  resolveRelative,
  safeFileName,
  slugFromPath,
  templateError,
} from "../src/core/paths.js";

describe("fillTemplate", () => {
  it("fills fields, nested fields and missing values", () => {
    expect(
      fillTemplate("{action} {meta.kind}: {title}{missing}", {
        action: "Update",
        meta: { kind: "post" },
        title: "Hello",
      }),
    ).toBe("Update post: Hello");
  });

  it("slugifies the inserted values, not the template", () => {
    expect(
      fillTemplate(
        "{date|year}/{date|month}/{title}",
        { date: "2026-11-13", title: "My Title: a/b" },
        { slug: true },
      ),
    ).toBe("2026/11/my-title-a-b");
  });

  it.each([
    ["a date string", "2026-01-05"],
    ["a local datetime string", "2026-01-05T23:30"],
    ["a datetime string in another time zone", "2026-01-05T23:30:00-06:00"],
    ["a UTC datetime string", "2026-01-05T00:00:00.000Z"],
    ["a Date, as YAML parses a date", new Date("2026-01-05")],
  ])("reads the parts of %s", (_, date) => {
    expect(fillTemplate("{date|year}-{date|month}-{date|day}", { date })).toBe(
      "2026-01-05",
    );
  });

  it("reads a nested date and allows spaces around the pipe", () => {
    expect(
      fillTemplate("{meta.published | year}", {
        meta: { published: "1999-12-31" },
      }),
    ).toBe("1999");
  });

  it.each([
    ["an empty value", ""],
    ["a missing value", undefined],
    ["text", "tomorrow"],
    ["a number", 20261113],
    ["an invalid Date", new Date("nope")],
  ])("gives nothing for %s", (_, date) => {
    expect(fillTemplate("{date|year}", { date })).toBe("");
  });

  it("writes a whole date as before", () => {
    expect(fillTemplate("{date}", { date: new Date("2026-01-05") })).toBe(
      "2026-01-05",
    );
    expect(
      fillTemplate(
        "{date}-{title}",
        { date: "2026-01-05", title: "Hi" },
        { slug: true },
      ),
    ).toBe("2026-01-05-hi");
  });

  it("leaves a value unfiltered when the filter is unknown", () => {
    expect(fillTemplate("{title|shout}", { title: "Hi" })).toBe("Hi");
    expect(fillTemplate("{title|toString}", { title: "Hi" })).toBe("Hi");
  });
});

describe("templateError", () => {
  it("accepts the known filters", () => {
    expect(templateError("{date|year}/{date|month}/{date|day}/{title}")).toBe(
      undefined,
    );
    expect(templateError("{action} {singular}: {title}")).toBe(undefined);
  });

  it("names an unknown filter", () => {
    expect(templateError("{date|yaer}/{title}")).toBe(
      'unknown filter "yaer" in "{date|yaer}" (filters: year, month, day, nodate)',
    );
    expect(templateError("{title|constructor}")).toMatch(/unknown filter/);
  });
});

describe("config validation", () => {
  const config = (collection: object) => ({
    repo: { owner: "o", name: "r" },
    collections: {
      articles: {
        label: "Articles",
        path: "src/content/articles/**.mdx",
        schema: {},
        ...collection,
      },
    },
  });

  it("accepts date parts in a slug template", () => {
    expect(() =>
      vestry(
        config({
          slug: { template: "{date|year}/{date|month}/{title}" },
          previewUrl: "/articles/{slug}",
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    ["slug.template", { slug: { template: "{date|yaer}/{title}" } }],
    ["previewUrl", { previewUrl: "/{date|yaer}/{slug}" }],
    ["commitMessage", { commitMessage: "{action} {title|yaer}" }],
  ])("rejects an unknown filter in %s", (where, collection) => {
    expect(() => vestry(config(collection))).toThrow(
      `[vestry] collection "articles" ${where}: unknown filter "yaer"`,
    );
  });

  it("rejects a nested slug template for a path that cannot hold one", () => {
    expect(() =>
      vestry(
        config({
          path: "src/content/articles/*.mdx",
          slug: { template: "{date|year}/{title}" },
        }),
      ),
    ).toThrow('slug.template contains "/", which needs a "**" wildcard');
  });

  it("rejects a tree for a path with no folders", () => {
    expect(() => vestry(config({ tree: true }))).not.toThrow();
    for (const path of ["src/content/articles/*.mdx", "src/data/articles.json"])
      expect(() => vestry(config({ path, tree: "only" }))).toThrow(
        'sets tree, which needs a "**" wildcard',
      );
  });
});

describe("nested slugs", () => {
  const pattern = parsePathPattern("src/content/articles/**.mdx");

  it("map to nested files and back", () => {
    const path = entryPath(pattern, "2026/11/my-title");
    expect(path).toBe("src/content/articles/2026/11/my-title.mdx");
    expect(slugFromPath(pattern, path)).toBe("2026/11/my-title");
    expect(isSafeSlug("2026/11/my-title")).toBe(true);
  });

  it("fill a preview URL", () => {
    expect(
      fillTemplate("/articles/{slug}", {
        slug: "2026/11/my-title",
        title: "My Title",
      }),
    ).toBe("/articles/2026/11/my-title");
  });

  it("are unsafe with an empty segment, as a blank date would leave", () => {
    expect(isSafeSlug("//my-title")).toBe(false);
  });
});

describe("safeFileName", () => {
  it("drops the directory, on either kind of separator", () => {
    expect(safeFileName("../../etc/Passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\photo.png")).toBe("photo.png");
  });

  it("folds accents and replaces other characters with a dash", () => {
    expect(safeFileName("Café Photo (1).JPG")).toBe("cafe-photo-1.jpg");
  });

  it("names a file that has nothing left", () => {
    expect(safeFileName("???.png")).toBe("file.png");
    expect(safeFileName("")).toBe("file");
  });
});

describe("relative paths", () => {
  const dir = "src/content/articles";

  it("resolve against a directory", () => {
    expect(resolveRelative(dir, "../../assets/images/a.jpg")).toBe(
      "src/assets/images/a.jpg",
    );
    expect(resolveRelative(dir, "./images/./a.jpg")).toBe(
      "src/content/articles/images/a.jpg",
    );
  });

  it("stop at the repository root", () => {
    expect(resolveRelative("src", "../../a.jpg")).toBe("a.jpg");
  });

  it("are written from a directory, and read back", () => {
    for (const [file, rel] of [
      ["src/assets/images/a.jpg", "../../assets/images/a.jpg"],
      ["src/content/articles/images/a.jpg", "./images/a.jpg"],
    ]) {
      expect(relativePath(dir, file)).toBe(rel);
      expect(resolveRelative(dir, rel)).toBe(file);
    }
  });
});

/**
 * Property tests for the path, slug and frontmatter helpers: each pair of
 * functions that writes and reads the same thing must agree.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseEntry, serializeEntry } from "../src/core/entries.js";
import {
  dateFromSlug,
  entryPath,
  isSafeSlug,
  parsePathPattern,
  relativePath,
  resolveRelative,
  slugFromPath,
  slugify,
  slugWithDate,
  slugWithoutDate,
} from "../src/core/paths.js";
import {
  assetToRepoPath,
  defaultStorage,
  repoPathToAsset,
} from "../src/core/values.js";

fc.configureGlobal({ numRuns: Number(process.env.FC_RUNS) || 200 });

const segment = fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,6}$/);
const dirArb = fc.array(segment, { maxLength: 3 }).map((s) => s.join("/"));
const fileArb = fc
  .array(segment, { minLength: 1, maxLength: 4 })
  .map((s) => s.join("/"));

const dateArb = fc
  .date({
    min: new Date("1900-01-01T00:00:00Z"),
    max: new Date("2100-12-31T00:00:00Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

describe("paths", () => {
  it("resolves a relative path back to the file", () => {
    fc.assert(
      fc.property(dirArb, fileArb, (dir, file) => {
        expect(resolveRelative(dir, relativePath(dir, file))).toBe(file);
      }),
    );
  });

  it("reads the slug back from an entry's path", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "src/content/posts/*.md",
          "posts/**/index.mdx",
          "data/*.json",
        ),
        fc.array(segment, { minLength: 1, maxLength: 3 }),
        (pattern, parts) => {
          const parsed = parsePathPattern(pattern);
          const slug = parsed.deep ? parts.join("/") : parts[0];
          // Segments never start with `_`, which Astro ignores.
          fc.pre(isSafeSlug(slug));
          expect(slugFromPath(parsed, entryPath(parsed, slug))).toBe(slug);
        },
      ),
    );
  });
});

describe("slugs", () => {
  it("slugifies to a safe slug, and only once", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 30 }), (input) => {
        const slug = slugify(input);
        expect(slugify(slug)).toBe(slug);
        expect(slug === "" || isSafeSlug(slug)).toBe(true);
      }),
    );
  });

  it("puts a date in a slug's file name and reads it back", () => {
    fc.assert(
      fc.property(dirArb, segment, dateArb, (dir, name, date) => {
        const slug = dir ? `${dir}/${name}` : name;
        const dated = slugWithDate(slug, date);
        expect(dateFromSlug(dated)).toBe(date);
        expect(slugWithoutDate(dated)).toBe(slugWithoutDate(slug));
        expect(slugWithDate(dated, date)).toBe(dated);
      }),
    );
  });
});

describe("assets", () => {
  it.each(["relative", "public", "repo"] as const)(
    "reads back a %s reference to a file in the field's directory",
    (storeAs) => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            "public/images",
            "src/assets/images",
            "src/content/posts",
          ),
          fileArb,
          fc.constantFrom(
            "src/content/posts/a.md",
            "src/content/b/c/d.mdx",
            "e.md",
          ),
          (directory, name, entryFile) => {
            fc.pre(storeAs !== "public" || directory.startsWith("public/"));
            const field = { directory, storeAs };
            const repoPath = `${directory}/${name}`;
            const stored = repoPathToAsset(field, repoPath, entryFile);
            expect(assetToRepoPath(field, stored, entryFile)).toBe(repoPath);
          },
        ),
      );
    },
  );
});

describe("public URLs", () => {
  it("reads a URL as the public file it names, in any field's directory", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("public/images", "public/shots", "src/assets/images"),
        fileArb.filter((f) => !/^(src|public)\//.test(f)),
        (directory, path) => {
          const url = `/${path}`;
          const repoPath = assetToRepoPath({ directory }, url, "src/a.md");
          expect(repoPath).toBe(`public/${path}`);
          expect(
            repoPathToAsset({ directory, storeAs: "public" }, repoPath, ""),
          ).toBe(url);
        },
      ),
    );
  });

  it("reads a repository path written with a leading slash", () => {
    const field = { directory: "src/assets/images" };
    expect(assetToRepoPath(field, "/src/assets/images/a.png", "x.md")).toBe(
      "src/assets/images/a.png",
    );
    expect(
      assetToRepoPath({ directory: "public/shots" }, "/public/shots/a.png", ""),
    ).toBe("public/shots/a.png");
  });

  it("writes a file outside a filename field's directory so it still names it", () => {
    const field = {
      directory: "src/assets/images",
      storeAs: "filename" as const,
    };
    for (const value of ["/images/a.png", "src/assets/other/b.png"]) {
      const repoPath = assetToRepoPath(field, value, "src/content/x.md");
      expect(repoPathToAsset(field, repoPath, "src/content/x.md")).toBe(value);
    }
    expect(
      repoPathToAsset(field, "src/assets/images/c.png", "src/content/x.md"),
    ).toBe("c.png");
  });

  it("keeps a protocol-relative URL", () => {
    const field = { directory: "public/shots" };
    const url = "//cdn.example.com/a.png";
    expect(assetToRepoPath(field, url, "")).toBe(url);
    expect(repoPathToAsset(field, url, "")).toBe(url);
  });

  it("stores URLs by default in public/ itself", () => {
    const field = { directory: "public" };
    expect(defaultStorage(field)).toBe("public");
    expect(assetToRepoPath(field, "/src/a.pdf", "")).toBe("public/src/a.pdf");
    expect(repoPathToAsset(field, "public/a.pdf", "src/content/x.md")).toBe(
      "/a.pdf",
    );
  });
});

describe("frontmatter", () => {
  /** Values a YAML 1.1 reader might mistake for another type, and filler. */
  const scalarString = fc.oneof(
    fc.string({ maxLength: 12 }),
    fc.constantFrom(
      "2026-11-13",
      "yes",
      "No",
      "~",
      "null",
      "0123",
      "1:30",
      ".inf",
      "1e3",
      "0x1F",
      "- a",
      "a: b",
      "#tag",
      "'quoted'",
      "@handle",
      "",
      " lead",
      "trail ",
    ),
  );
  const value = fc.letrec((tie) => ({
    v: fc.oneof(
      { depthSize: "small" },
      scalarString,
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(tie("v"), { maxLength: 3 }),
      fc.dictionary(fc.constantFrom("a", "b", "title"), tie("v"), {
        maxKeys: 2,
      }),
    ),
  })).v;

  it.each(["md", "yaml", "json"] as const)(
    "reads back what a %s entry writes",
    (format) => {
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.constantFrom("title", "date", "tags", "on", "n"),
            value,
          ),
          (data) => {
            const body = format === "md" ? "Body text\n" : "";
            const text = serializeEntry(format, { data, body });
            expect(parseEntry(format, text)).toEqual({ data, body });
          },
        ),
      );
    },
  );
});

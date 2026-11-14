import { describe, expect, it } from "vitest";
import { ignoreMatcher } from "../src/core/ignore.js";

describe("ignoreMatcher", () => {
  const ignored = ignoreMatcher(
    [
      "# content is written by the control panel",
      "src/content/",
      "",
      "dist",
      "*.lock",
      "/notes.md",
      "docs/**/*.mdx",
      "!docs/keep.mdx",
      "!src/content/keep.md",
      "*.[jt]sx",
      "\\#notes.md",
    ].join("\n"),
  );

  it("ignores everything beneath a directory pattern", () => {
    expect(ignored("src/content/posts/2026/11/hello.mdx")).toBe(true);
    expect(ignored("src/contents/hello.mdx")).toBe(false);
  });

  it("matches a pattern without a slash at any depth", () => {
    expect(ignored("dist/index.js")).toBe(true);
    expect(ignored("packages/site/dist/index.js")).toBe(true);
    expect(ignored("pnpm.lock")).toBe(true);
    expect(ignored("district/index.js")).toBe(false);
  });

  it("anchors a pattern with a slash to the root", () => {
    expect(ignored("notes.md")).toBe(true);
    expect(ignored("src/notes.md")).toBe(false);
  });

  it("supports ** and lets a later negation win", () => {
    expect(ignored("docs/guide/intro.mdx")).toBe(true);
    expect(ignored("docs/intro.mdx")).toBe(true);
    expect(ignored("docs/intro.md")).toBe(false);
    expect(ignored("docs/keep.mdx")).toBe(false);
  });

  it("keeps everything in an ignored directory ignored, as git does", () => {
    expect(ignored("src/content/keep.md")).toBe(true);
  });

  it("supports character classes and escapes", () => {
    expect(ignored("src/App.tsx")).toBe(true);
    expect(ignored("src/App.jsx")).toBe(true);
    expect(ignored("src/App.csx")).toBe(false);
    expect(ignored("#notes.md")).toBe(true);
  });

  it("normalizes leading ./ and backslashes", () => {
    expect(ignored("./src/content/a.md")).toBe(true);
    expect(ignored("src\\content\\a.md")).toBe(true);
  });

  it("ignores nothing without patterns", () => {
    expect(ignoreMatcher("")("src/content/a.md")).toBe(false);
  });
});

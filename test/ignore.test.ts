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
      "!src/content/keep.md",
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
    expect(ignored("src/content/keep.md")).toBe(false);
  });

  it("normalizes leading ./ and backslashes", () => {
    expect(ignored("./src/content/a.md")).toBe(true);
    expect(ignored("src\\content\\a.md")).toBe(true);
  });

  it("ignores nothing without patterns", () => {
    expect(ignoreMatcher("")("src/content/a.md")).toBe(false);
  });
});

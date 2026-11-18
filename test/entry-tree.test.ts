import { describe, expect, it } from "vitest";
import type { EntrySummary } from "../src/core/service.js";
import { relativeTitle, treeRows } from "../src/ui/lib/entry-tree.js";

const entry = (slug: string, title: string) =>
  ({ slug, title, status: "published", data: {} }) as EntrySummary;

const entries = [
  entry("cw21", "Christian Worship (2021)"),
  entry("cw21/1year", "Christian Worship (2021) - 1-Year Lectionary"),
  entry(
    "cw21/1year/advent",
    "Christian Worship (2021) - 1-Year Lectionary: Advent",
  ),
  entry("cw21/occasions", "Christian Worship (2021): Occasions"),
  entry("about", "About"),
  entry("guides/one", "Guide one"),
];

describe("relativeTitle", () => {
  it("drops what a title repeats from its parent's, with the separators", () => {
    expect(relativeTitle("CW - Year A: Advent", "CW - Year A")).toBe("Advent");
    expect(relativeTitle("CW, Advent", "CW")).toBe("Advent");
    expect(relativeTitle("CW — Advent", "CW")).toBe("Advent");
  });

  it("keeps a title whole when no separator follows, or nothing after it", () => {
    expect(relativeTitle("CWS hymns", "CW")).toBe("CWS hymns");
    expect(relativeTitle("CW: ", "CW")).toBe("CW: ");
    expect(relativeTitle("CW", "CW")).toBe("CW");
    expect(relativeTitle("Advent", "CW")).toBe("Advent");
    expect(relativeTitle("Advent", undefined)).toBe("Advent");
  });
});

describe("treeRows", () => {
  it("shows the roots, with how many rows sit under each", () => {
    expect(
      treeRows(entries, new Set()).map((r) => [r.path, r.label, r.children]),
    ).toEqual([
      ["cw21", "Christian Worship (2021)", 2],
      ["about", "About", 0],
      ["guides", "guides", 1],
    ]);
  });

  it("shows the children of expanded rows, nested in order", () => {
    const rows = treeRows(entries, new Set(["cw21", "cw21/1year", "guides"]));
    expect(rows.map((r) => [r.path, r.depth, r.label])).toEqual([
      ["cw21", 0, "Christian Worship (2021)"],
      ["cw21/1year", 1, "1-Year Lectionary"],
      ["cw21/1year/advent", 2, "Advent"],
      ["cw21/occasions", 1, "Occasions"],
      ["about", 0, "About"],
      ["guides", 0, "guides"],
      ["guides/one", 1, "Guide one"],
    ]);
    // A folder with no entry of its own has a row but no entry.
    expect(rows.find((r) => r.path === "guides")?.entry).toBeUndefined();
    expect(rows.find((r) => r.path === "cw21")?.entry?.slug).toBe("cw21");
  });

  it("keeps a child under its parent whichever comes first", () => {
    const rows = treeRows(
      [entries[2], entries[0]],
      new Set(["cw21", "cw21/1year"]),
    );
    expect(rows.map((r) => r.path)).toEqual([
      "cw21",
      "cw21/1year",
      "cw21/1year/advent",
    ]);
  });
});

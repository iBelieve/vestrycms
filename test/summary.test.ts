import { describe, expect, it } from "vitest";
import { collection, fields } from "../src/config/index.js";
import { compareSortValues, summaryData } from "../src/core/values.js";

const seasons = collection({
  label: "Seasons",
  path: "src/content/seasons/**.yaml",
  titleField: "name",
  sort: { field: "order" },
  status: { field: "draft", publishedWhen: false },
  columns: ["name", "tags"],
  previewUrl: "/seasons/{kind}/{slug}",
  schema: {
    name: fields.text(),
    order: fields.number(),
    kind: fields.text(),
    draft: fields.boolean(),
    tags: fields.array(fields.text()),
    days: fields.array(fields.object({ html: fields.code() })),
    notes: fields.markdown(),
  },
});

describe("summaryData", () => {
  const data = {
    name: "Advent",
    order: 1,
    kind: "season",
    draft: false,
    tags: ["a", "b"],
    days: [{ html: "<p>long</p>" }],
    notes: "long text",
    legacy: { nested: true },
    stray: "kept",
  };

  it("keeps scalar fields and fields the collection names", () => {
    expect(summaryData(seasons, data)).toEqual({
      name: "Advent",
      order: 1,
      kind: "season",
      draft: false,
      tags: ["a", "b"],
      stray: "kept",
    });
  });

  it("leaves the entry's own data untouched", () => {
    summaryData(seasons, data);
    expect(data.days).toHaveLength(1);
  });
});

describe("compareSortValues", () => {
  const sorted = (values: unknown[], dir = 1) =>
    [...values].sort((a, b) => compareSortValues(a, b, dir));

  it("orders a field that mixes numbers and text the same from any start", () => {
    const values = [300, "12a", 5, "LSB 45", 40, 7, "100b", 2];
    const expected = [2, 5, 7, 40, 300, "100b", "12a", "LSB 45"];
    expect(sorted(values)).toEqual(expected);
    expect(sorted([...values].reverse())).toEqual(expected);
    expect(sorted(values, -1)).toEqual([...expected].reverse());
  });

  it("puts empty lists last, as it does missing values", () => {
    // (Array sort puts `undefined` last by itself, so `null` stands in.)
    expect(sorted([[], ["b"], null, ["a"], ["", null]])).toEqual([
      ["a"],
      ["b"],
      [],
      null,
      ["", null],
    ]);
    expect(sorted([[], ["b"], ["a"]], -1)).toEqual([["b"], ["a"], []]);
  });
});

import { describe, expect, it } from "vitest";
import { collection, fields } from "../src/config/index.js";
import { summaryData } from "../src/core/values.js";

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

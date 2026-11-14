import { describe, expect, it } from "vitest";
import { fillTemplate } from "../src/core/paths.js";

const values = {
  slug: "2012-07-31-textual-criticism",
  date: "2012-07-31",
  title: "Textual Criticism",
  nested: { key: "Value" },
};

describe("fillTemplate", () => {
  it("fills placeholders, including nested keys", () => {
    expect(fillTemplate("/posts/{slug}", values)).toBe(
      "/posts/2012-07-31-textual-criticism",
    );
    expect(fillTemplate("{nested.key}/{missing}", values)).toBe("Value/");
  });

  it("applies the date filters", () => {
    expect(
      fillTemplate("/articles/{date|year}/{date|month}/{slug|nodate}", values),
    ).toBe("/articles/2012/07/textual-criticism");
    expect(fillTemplate("{slug|year}-{slug|month}-{slug|day}", values)).toBe(
      "2012-07-31",
    );
    expect(
      fillTemplate("{date|year}", { date: new Date("2020-02-03T00:00:00Z") }),
    ).toBe("2020");
  });

  it("takes the date off the file name of a slug in a folder", () => {
    expect(
      fillTemplate("/{slug|nodate}", { slug: "notes/2012-07-31-criticism" }),
    ).toBe("/notes/criticism");
    expect(fillTemplate("/{slug | nodate }", values)).toBe(
      "/textual-criticism",
    );
  });

  it("gives nothing for a date part of a value without a date", () => {
    expect(fillTemplate("{title|year}", values)).toBe("");
    expect(fillTemplate("{title|nodate}", values)).toBe("Textual Criticism");
  });

  it("ignores an unknown filter", () => {
    expect(fillTemplate("{title|unknown}", values)).toBe("Textual Criticism");
  });

  it("slugifies values when asked", () => {
    expect(fillTemplate("{date}-{title}", values, { slug: true })).toBe(
      "2012-07-31-textual-criticism",
    );
  });
});

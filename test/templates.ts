/**
 * Template placeholders and filters (`{field}`, `{field|filter}`).
 * Run with: node --import tsx/esm test/templates.ts
 */
import assert from "node:assert/strict";
import { fillTemplate } from "../src/core/paths.js";

const values = {
  slug: "2012-07-31-textual-criticism",
  date: "2012-07-31",
  title: "Textual Criticism",
  nested: { key: "Value" },
};

assert.equal(
  fillTemplate("/posts/{slug}", values),
  "/posts/2012-07-31-textual-criticism",
);
assert.equal(
  fillTemplate("/articles/{date|year}/{date|month}/{slug|nodate}", values),
  "/articles/2012/07/textual-criticism",
);
assert.equal(
  fillTemplate("{slug|year}-{slug|month}-{slug|day}", values),
  "2012-07-31",
);
assert.equal(fillTemplate("{title|year}", values), "", "no date → empty");
assert.equal(fillTemplate("{title|nodate}", values), "Textual Criticism");
assert.equal(fillTemplate("{title|unknown}", values), "Textual Criticism");
assert.equal(
  fillTemplate("{date}-{title}", values, { slug: true }),
  "2012-07-31-textual-criticism",
);
assert.equal(fillTemplate("{nested.key}/{missing}", values), "Value/");
assert.equal(
  fillTemplate("{date|year}", { date: new Date("2020-02-03T00:00:00Z") }),
  "2020",
);

console.log("templates: ok");

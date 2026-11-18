import { describe, expect, it } from "vitest";
import {
  collection,
  defineConfig,
  fields,
  singleton,
} from "../src/config/index.js";
import { validateConfig } from "../src/config/validate.js";
import type { CollectionConfig, VestryConfig } from "../src/config/types.js";

const repo = { owner: "o", name: "r" };
const posts = (overrides: Partial<CollectionConfig> = {}): VestryConfig =>
  defineConfig({
    repo,
    collections: {
      posts: collection({
        label: "Posts",
        path: "content/posts/*.md",
        schema: { title: fields.text() },
        ...overrides,
      }),
    },
  });

describe("validateConfig", () => {
  it("accepts a date kept in the file name and known template filters", () => {
    expect(() =>
      validateConfig(
        posts({
          slug: { template: "{date}-{title}" },
          previewUrl: "/posts/{slug|year}/{slug|month}/{slug|nodate}",
          schema: {
            title: fields.text(),
            date: fields.date({ storeIn: "filename" }),
          },
        }),
      ),
    ).not.toThrow();
  });

  it("rejects an unknown template filter", () => {
    expect(() =>
      validateConfig(posts({ previewUrl: "/posts/{slug|yaer}" })),
    ).toThrow(/unknown filter "yaer"/);
    expect(() =>
      validateConfig(posts({ slug: { template: "{date|}-{title}" } })),
    ).toThrow(/unknown filter ""/);
    // Spaces around the bar, and names every object has, are no way round.
    expect(() =>
      validateConfig(posts({ previewUrl: "/posts/{slug | yaer}" })),
    ).toThrow(/unknown filter "yaer"/);
    expect(() =>
      validateConfig(posts({ previewUrl: "/posts/{slug|constructor}" })),
    ).toThrow(/unknown filter "constructor"/);
    expect(() =>
      validateConfig(posts({ previewUrl: "/posts/{slug | nodate }" })),
    ).not.toThrow();
  });

  it.each([
    [
      "a nested field",
      {
        schema: {
          meta: fields.object({ date: fields.date({ storeIn: "filename" }) }),
        },
      },
      /only for a top-level field/,
    ],
    [
      "two fields",
      {
        schema: {
          a: fields.date({ storeIn: "filename" }),
          b: fields.date({ storeIn: "filename" }),
        },
      },
      /only one field/,
    ],
    [
      "a field with time",
      {
        schema: {
          date: fields.date({ storeIn: "filename", time: "optional" }),
        },
      },
      /cannot be combined with time/,
    ],
    [
      "a single-file collection",
      {
        path: "content/posts.yaml",
        schema: { date: fields.date({ storeIn: "filename" }) },
      },
      /one file per entry/,
    ],
  ] as const)("rejects a file-name date on %s", (_name, overrides, message) => {
    expect(() =>
      validateConfig(posts(overrides as Partial<CollectionConfig>)),
    ).toThrow(message);
  });

  it("rejects a file-name date in a singleton", () => {
    expect(() =>
      validateConfig(
        defineConfig({
          repo,
          singletons: {
            site: singleton({
              label: "Site",
              path: "site.yaml",
              schema: { date: fields.date({ storeIn: "filename" }) },
            }),
          },
        }),
      ),
    ).toThrow(/one file per entry/);
  });

  it("allows only now as a date or datetime default", () => {
    // A `.js` config can set what the types rule out.
    const fixed = "2020-01-05" as "now";
    expect(() =>
      validateConfig(
        posts({
          schema: {
            date: fields.date({ default: "now" }),
            at: fields.datetime({ default: "now" }),
          },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateConfig(
        posts({ schema: { date: fields.date({ default: fixed }) } }),
      ),
    ).toThrow(/"date" has default "2020-01-05", but a date field's default/);
    expect(() =>
      validateConfig(
        posts({
          schema: {
            events: fields.array(
              fields.object({ at: fields.datetime({ default: fixed }) }),
            ),
          },
        }),
      ),
    ).toThrow(/"events\.\[\]\.at" has default .* a datetime field's default/);
    expect(() =>
      validateConfig(
        defineConfig({
          repo,
          singletons: {
            site: singleton({
              label: "Site",
              path: "site.yaml",
              schema: { date: fields.date({ default: fixed }) },
            }),
          },
        }),
      ),
    ).toThrow(/singleton "site": "date" has default/);
    expect(() =>
      validateConfig(
        defineConfig({
          repo,
          components: {
            Event: { props: { date: fields.date({ default: fixed }) } },
          },
        }),
      ),
    ).toThrow(/component "Event": "date" has default/);
  });

  it("rejects create and delete, which editable replaced", () => {
    expect(() => validateConfig(posts({ editable: false }))).not.toThrow();
    for (const old of ["create", "delete"])
      expect(() => validateConfig(posts({ [old]: false }))).toThrow(
        `sets ${old}, which Vestry replaced`,
      );
  });

  it("accepts reserved slugs, but only slugs", () => {
    expect(() =>
      validateConfig(posts({ reservedSlugs: ["index", "404"] })),
    ).not.toThrow();
    expect(() => validateConfig(posts({ reservedSlugs: ["../x"] }))).toThrow(
      'reservedSlugs has "../x", which is not a slug',
    );
    expect(() =>
      validateConfig(posts({ reservedSlugs: [undefined as never] })),
    ).toThrow("reservedSlugs has undefined, which is not a slug");
  });

  it("accepts pinned slugs, but only a list of slugs", () => {
    expect(() =>
      validateConfig(posts({ pinned: ["index", "docs/start"] })),
    ).not.toThrow();
    expect(() => validateConfig(posts({ pinned: "index" as never }))).toThrow(
      "pinned must be a list of slugs",
    );
    expect(() => validateConfig(posts({ pinned: ["/x"] }))).toThrow(
      'pinned has "/x", which is not a slug',
    );
  });

  it("accepts editable only as true or false", () => {
    expect(() => validateConfig(posts({ editable: "false" as never }))).toThrow(
      "editable must be true or false",
    );
  });

  it("still requires the repository", () => {
    expect(() => validateConfig({ repo: { owner: "", name: "" } })).toThrow(
      /repo\.owner/,
    );
  });
});

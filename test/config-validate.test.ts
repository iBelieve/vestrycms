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

  it("rejects create, delete and editable, which fixedEntries replaced", () => {
    expect(() =>
      validateConfig(posts({ fixedEntries: true, readOnly: true })),
    ).not.toThrow();
    for (const old of ["create", "delete", "editable"])
      expect(() => validateConfig(posts({ [old]: false }))).toThrow(
        `sets ${old}, which Vestry replaced`,
      );
    expect(() => validateConfig(posts({ editable: false } as never))).toThrow(
      "set fixedEntries: true",
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

  it("accepts pinned slugs, with or without icons, but only slugs", () => {
    expect(() =>
      validateConfig(
        posts({ pinned: [{ slug: "index", icon: "house" }, "docs/start"] }),
      ),
    ).not.toThrow();
    expect(() => validateConfig(posts({ pinned: "index" as never }))).toThrow(
      "pinned must be a list of slugs or { slug, icon }",
    );
    expect(() => validateConfig(posts({ pinned: ["/x"] }))).toThrow(
      'pinned has "/x", which is not a slug',
    );
    expect(() =>
      validateConfig(posts({ pinned: [{ icon: "house" } as never] })),
    ).toThrow("pinned has undefined, which is not a slug");
    expect(() =>
      validateConfig(posts({ pinned: [{ slug: "404", icon: 4 as never }] })),
    ).toThrow('pinned icon for "404" must be an icon name');
    // A name the panel doesn't draw would show as a plain file icon.
    expect(() =>
      validateConfig(posts({ pinned: [{ slug: "index", icon: "home" }] })),
    ).toThrow(
      'pinned icon for "index" is "home", which is not one of the panel\'s icons',
    );
    // A pair instead of { slug, icon } is named as written.
    expect(() =>
      validateConfig(posts({ pinned: [["index", "house"] as never] })),
    ).toThrow('pinned has ["index","house"], which is not a slug');
  });

  it("accepts only the panel's icons on collections, singletons, assets and components", () => {
    const config = (icon: string) =>
      defineConfig({
        repo,
        collections: {
          faqs: collection({
            label: "FAQs",
            path: "content/faqs/*.md",
            schema: { title: fields.text() },
            icon,
          }),
        },
      });
    expect(() => validateConfig(config("circle-question-mark"))).not.toThrow();
    // Lucide's old name, which the panel would draw as a plain file icon.
    expect(() => validateConfig(config("circle-help"))).toThrow(
      'collection "faqs" icon is "circle-help", which is not one of the panel\'s icons',
    );
    expect(() =>
      validateConfig(
        defineConfig({
          repo,
          singletons: {
            site: singleton({
              label: "Site",
              path: "site.yaml",
              schema: {},
              icon: "gear",
            }),
          },
        }),
      ),
    ).toThrow('singleton "site" icon is "gear"');
    expect(() =>
      validateConfig(
        defineConfig({
          repo,
          assets: {
            downloads: {
              label: "Downloads",
              directory: "public/downloads",
              icon: "arrow-down",
            },
          },
        }),
      ),
    ).toThrow('asset container "downloads" icon is "arrow-down"');
    expect(() =>
      validateConfig(
        defineConfig({ repo, components: { Callout: { icon: 4 as never } } }),
      ),
    ).toThrow('component "Callout" icon must be an icon name');
  });

  it("accepts fixedEntries, readOnly and dashboard only as true or false", () => {
    for (const flag of ["fixedEntries", "readOnly", "dashboard"])
      expect(() => validateConfig(posts({ [flag]: "true" as never }))).toThrow(
        `${flag} must be true or false`,
      );
  });

  it("accepts recent only as true, false or a number", () => {
    for (const recent of [true, false, 0, 3])
      expect(() => validateConfig(posts({ recent }))).not.toThrow();
    for (const recent of ["5", null, Infinity, Number.NaN])
      expect(() => validateConfig(posts({ recent: recent as never }))).toThrow(
        "recent must be true, false or a number of entries",
      );
  });

  it("rejects a recent list on a collection off the dashboard", () => {
    for (const recent of [true, 3])
      expect(() => validateConfig(posts({ dashboard: false, recent }))).toThrow(
        "sets recent, but dashboard: false leaves it off the dashboard",
      );
    for (const recent of [false, 0, undefined])
      expect(() =>
        validateConfig(posts({ dashboard: false, recent })),
      ).not.toThrow();
  });

  it("still requires the repository", () => {
    expect(() => validateConfig({ repo: { owner: "", name: "" } })).toThrow(
      /repo\.owner/,
    );
  });
});

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

  it("still requires the repository", () => {
    expect(() => validateConfig({ repo: { owner: "", name: "" } })).toThrow(
      /repo\.owner/,
    );
  });
});

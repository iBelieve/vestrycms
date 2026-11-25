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
  it("checks forms' names, labels, icons and columns", () => {
    const withForms = (forms: unknown) =>
      ({ repo, forms }) as unknown as VestryConfig;
    expect(() =>
      validateConfig(
        withForms({
          contact: { label: "Contact form", icon: "mail", columns: ["name"] },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateConfig(withForms({ Contact: { label: "x" } })),
    ).toThrow(/form "Contact": a form's name must be lowercase/);
    expect(() => validateConfig(withForms({ contact: {} }))).toThrow(
      /form "contact" needs a label/,
    );
    expect(() =>
      validateConfig(withForms({ contact: { label: "x", icon: "envelope" } })),
    ).toThrow(/form "contact" icon is "envelope"/);
    expect(() =>
      validateConfig(withForms({ contact: { label: "x", columns: "name" } })),
    ).toThrow(/form "contact" columns must be a list of field names/);
    expect(() => validateConfig(withForms([]))).toThrow(
      /forms must be an object/,
    );
  });

  it("accepts a top-level field for some entries", () => {
    expect(() =>
      validateConfig(
        posts({
          schema: {
            title: fields.text(),
            tagline: fields.text({ entries: ["index", "guides/index"] }),
          },
        }),
      ),
    ).not.toThrow();
  });

  it("rejects entries that name nothing, or where there are no entries to choose", () => {
    const withField = (field: ReturnType<typeof fields.text>) =>
      posts({ schema: { title: fields.text(), tagline: field } });
    expect(() =>
      validateConfig(withField(fields.text({ entries: [] }))),
    ).toThrow(/"tagline" has entries: \[\], which shows it nowhere/);
    expect(() =>
      validateConfig(withField(fields.text({ entries: ["../x"] }))),
    ).toThrow(/"tagline" entries has "..\/x", which is not a slug/);
    expect(() =>
      validateConfig(
        withField(fields.text({ entries: "index" as unknown as string[] })),
      ),
    ).toThrow(/"tagline" entries must be a list of slugs/);
    expect(() =>
      validateConfig(
        posts({
          schema: {
            meta: fields.object({
              tagline: fields.text({ entries: ["index"] }),
            }),
          },
        }),
      ),
    ).toThrow(
      /"meta.tagline" sets entries, but it is only for a top-level field/,
    );
    expect(() =>
      validateConfig(
        defineConfig({
          repo,
          singletons: {
            site: singleton({
              label: "Site",
              path: "src/data/site.yaml",
              schema: { tagline: fields.text({ entries: ["index"] }) },
            }),
          },
        }),
      ),
    ).toThrow(
      /singleton "site": "tagline" sets entries, but a singleton has one entry/,
    );
    expect(() =>
      validateConfig(
        defineConfig({
          repo,
          singletons: {
            site: singleton({
              label: "Site",
              path: "src/data/site.yaml",
              schema: {
                hero: fields.object({
                  tagline: fields.text({ entries: ["index"] }),
                }),
              },
            }),
          },
        }),
      ),
    ).toThrow(
      /singleton "site": "hero.tagline" sets entries, but a singleton has one entry/,
    );
    expect(() =>
      validateConfig(
        defineConfig({
          repo,
          components: {
            Hero: {
              label: "Hero",
              props: { title: fields.text({ entries: ["index"] }) },
            },
          },
        }),
      ),
    ).toThrow(/component "Hero": "title" sets entries/);
  });

  it("rejects entries on a field that every entry has", () => {
    expect(() =>
      validateConfig(
        posts({ schema: { title: fields.text({ entries: ["index"] }) } }),
      ),
    ).toThrow(/"title" sets entries, but the title shows in every entry/);
    expect(() =>
      validateConfig(
        posts({
          status: { field: "draft", publishedWhen: false },
          schema: {
            title: fields.text(),
            draft: fields.boolean({ entries: ["index"] }),
          },
        }),
      ),
    ).toThrow(/"draft" sets entries, but the publish switch shows/);
    expect(() =>
      validateConfig(
        posts({
          schema: {
            title: fields.text(),
            date: fields.date({ storeIn: "filename", entries: ["index"] }),
          },
        }),
      ),
    ).toThrow(
      /"date" sets entries, but every entry's file name holds its date/,
    );
    expect(() =>
      validateConfig(
        posts({
          schema: {
            title: fields.text(),
            updated: fields.datetime({ autoUpdate: true, entries: ["index"] }),
          },
        }),
      ),
    ).toThrow(/"updated" sets entries, but saving any entry sets it/);
    // A title that isn't a text box is an ordinary field.
    expect(() =>
      validateConfig(
        posts({
          schema: { title: fields.textarea({ entries: ["index"] }) },
        }),
      ),
    ).not.toThrow();
  });

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

  it("accepts a logo path, or onDark and onLight, and nothing else", () => {
    const withLogo = (logo: unknown) =>
      ({ repo, logo }) as unknown as VestryConfig;
    for (const logo of [
      "src/assets/logo.svg",
      "https://example.org/logo.svg",
      { onDark: "src/assets/logo.svg" },
      { onLight: "src/assets/logo-light.svg" },
      { onDark: "src/assets/logo.svg", onLight: "src/assets/logo-light.svg" },
    ])
      expect(() => validateConfig(withLogo(logo))).not.toThrow();
    // An empty string is no logo, as it always was.
    expect(() => validateConfig(withLogo(""))).not.toThrow();
    expect(() => validateConfig(withLogo(" "))).toThrow(
      "logo must be a repository path or a URL",
    );
    expect(() => validateConfig(withLogo(42))).toThrow(
      "logo must be a path or URL, or { onDark, onLight }",
    );
    expect(() => validateConfig(withLogo({}))).toThrow(
      "logo needs onDark, onLight or both",
    );
    expect(() =>
      validateConfig(withLogo({ dark: "src/assets/logo.svg" })),
    ).toThrow('logo has an unknown key "dark"; use onDark and onLight');
    expect(() => validateConfig(withLogo({ onLight: 1 }))).toThrow(
      "logo.onLight must be a repository path or a URL",
    );
  });

  it("refuses a logo path the API could never serve", () => {
    const withLogo = (logo: unknown) =>
      ({ repo, logo }) as unknown as VestryConfig;
    expect(() =>
      validateConfig(withLogo("HTTPS://example.org/logo.svg")),
    ).not.toThrow();
    for (const logo of [
      "/",
      "../logo.svg",
      " src/assets/logo.svg",
      "//cdn.example.org/logo.svg",
    ])
      expect(() => validateConfig(withLogo(logo))).toThrow(
        "logo must be a repository path or a URL",
      );
    expect(() => validateConfig(withLogo({ onDark: "src/../.git/x" }))).toThrow(
      "logo.onDark must be a repository path or a URL",
    );
  });

  it("accepts signIn.showName only as true or false", () => {
    const withSignIn = (signIn: unknown) =>
      ({ repo, signIn }) as unknown as VestryConfig;
    expect(() => validateConfig(withSignIn({ showName: true }))).not.toThrow();
    expect(() => validateConfig(withSignIn({}))).not.toThrow();
    expect(() => validateConfig(withSignIn({ showName: "yes" }))).toThrow(
      "signIn.showName must be true or false",
    );
    expect(() => validateConfig(withSignIn(true))).toThrow(
      "signIn must be an object",
    );
    expect(() => validateConfig(withSignIn([]))).toThrow(
      "signIn must be an object",
    );
    expect(() => validateConfig(withSignIn({ showname: true }))).toThrow(
      'signIn has an unknown key "showname"; use showName',
    );
  });

  it("still requires the repository", () => {
    expect(() => validateConfig({ repo: { owner: "", name: "" } })).toThrow(
      /repo\.owner/,
    );
  });
});

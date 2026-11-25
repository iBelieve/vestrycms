import { afterEach, describe, expect, it, vi } from "vitest";
import { fields } from "../src/config/index.js";
import type { Field, Schema } from "../src/config/types.js";
import {
  cssToStyle,
  defaultValue,
  defaultValues,
  formatBytes,
  formatDate,
  inSentence,
  initials,
  siteHref,
  summarize,
  summarizeProps,
  titleCase,
  validate,
} from "../src/ui/lib/utils.js";
import { gravatarUrl } from "../src/ui/components/Avatar.js";

describe("defaultValue", () => {
  afterEach(() => vi.useRealTimers());

  it("gives each type of field its empty value", () => {
    const cases: [Field, unknown][] = [
      [fields.text(), ""],
      [fields.text({ default: "x" }), "x"],
      [fields.image({ directory: "a" }), ""],
      [fields.number(), null],
      [fields.number({ default: 3 }), 3],
      [fields.boolean(), false],
      [fields.date(), ""],
      [fields.datetime(), ""],
      [fields.multiselect({ options: [] }), []],
      [fields.array(fields.text()), []],
      [fields.json(), null],
      [fields.crop({ image: "a" }), undefined],
      [fields.focalPoint({ image: "a" }), undefined],
      [fields.tree({ fields: {} }), []],
      [fields.object({ a: fields.text({ default: "b" }) }), { a: "b" }],
    ];
    for (const [field, value] of cases)
      expect([field.type, defaultValue(field)]).toEqual([field.type, value]);
  });

  it("gives the editor's own date and time for a field that defaults to now", () => {
    // 7:30 PM in Chicago is already the next day in UTC.
    const tz = process.env.TZ;
    process.env.TZ = "America/Chicago";
    try {
      vi.useFakeTimers({ now: new Date("2026-11-18T01:30:15.000Z") });
      expect(defaultValue(fields.date({ default: "now" }))).toBe("2026-11-17");
      // A datetime is stored as wall-clock time unless it says otherwise,
      // which is what its input writes.
      expect(defaultValue(fields.datetime({ default: "now" }))).toBe(
        "2026-11-17T19:30",
      );
      expect(
        defaultValue(fields.datetime({ default: "now", storage: "local" })),
      ).toBe("2026-11-17T19:30");
      expect(
        defaultValue(fields.datetime({ default: "now", storage: "iso" })),
      ).toBe("2026-11-18T01:30:15.000Z");
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it("picks a select's first option unless it can be cleared", () => {
    const options = [{ label: "A", value: "a" }];
    expect(defaultValue(fields.select({ options }))).toBe("a");
    expect(defaultValue(fields.select({ options, clearable: true }))).toBe("");
    expect(defaultValue(fields.select({ options: [] }))).toBe("");
    expect(defaultValue(fields.select({ options, default: "b" }))).toBe("b");
  });

  it("gives nothing for a type it does not know", () => {
    expect(defaultValue({ type: "unknown" } as unknown as Field)).toBe(
      undefined,
    );
  });
});

describe("defaultValues", () => {
  it("keeps the fields with a value, and every boolean", () => {
    expect(
      defaultValues({
        title: fields.text(),
        count: fields.number({ default: 0 }),
        draft: fields.boolean(),
        tags: fields.array(fields.text()),
        kind: fields.text({ default: "post" }),
      }),
    ).toEqual({ count: 0, draft: false, kind: "post" });
  });
});

describe("validate", () => {
  const schema: Schema = {
    title: fields.text({ required: true, maxLength: 5 }),
    code: fields.text({ pattern: "^[A-Z]+$" }),
    note: fields.textarea({ maxLength: 3 }),
    count: fields.number({ min: 1, max: 3 }),
    meta: fields.object({ author: fields.text({ required: true }) }),
    links: fields.array(
      fields.object({ url: fields.text({ required: true, label: "URL" }) }),
      { min: 2, max: 3 },
    ),
    menu: fields.tree({
      fields: { label: fields.text({ required: true }) },
      childrenKey: "items",
    }),
    tags: fields.array(fields.text(), { max: 1 }),
  };

  it("passes valid data", () => {
    expect(
      validate(schema, {
        title: "Hi",
        code: "AB",
        count: 2,
        meta: { author: "Ann" },
        links: [{ url: "a" }, { url: "b" }],
        menu: [{ label: "Home", items: [{ label: "Sub" }] }],
      }),
    ).toEqual([]);
  });

  it("reports each problem at its path", () => {
    expect(
      validate(schema, {
        title: "Too long",
        code: "ab",
        note: "long",
        count: 0,
        meta: { author: "" },
        links: [{ url: "" }],
        menu: [null, { label: "", items: [{ label: "" }] }],
        tags: ["a", "b"],
      }),
    ).toEqual([
      { path: "title", message: "Title must be at most 5 characters" },
      { path: "code", message: "Code is not in the expected format" },
      { path: "note", message: "Note must be at most 3 characters" },
      { path: "count", message: "Count must be at least 1" },
      { path: "meta.author", message: "Author is required" },
      { path: "links", message: "Links needs at least 2 items" },
      { path: "links.0.url", message: "URL is required" },
      { path: "menu.1.label", message: "Label is required" },
      { path: "menu.1.items.0.label", message: "Label is required" },
      { path: "tags", message: "Tags allows at most 1 items" },
    ]);
  });

  it("checks a number's maximum and an array's", () => {
    expect(
      validate(schema, {
        title: "a",
        count: 4,
        links: [{ url: "a" }, { url: "b" }, { url: "c" }, { url: "d" }],
      }).map((e) => e.message),
    ).toEqual(["Count must be at most 3", "Links allows at most 3 items"]);
  });

  it("requires values, and ignores those of the wrong shape", () => {
    expect(
      validate(schema, {
        count: "2",
        meta: "x",
        menu: "x",
        links: "x",
      }).map((e) => e.path),
    ).toEqual(["title"]);
    expect(validate(schema, undefined as never)).toEqual([
      { path: "title", message: "Title is required" },
    ]);
  });
});

describe("summarize", () => {
  it("describes a value in a few words", () => {
    expect(summarize(null)).toBe("");
    expect(summarize("text")).toBe("text");
    expect(summarize(3)).toBe("3");
    expect(summarize(false)).toBe("false");
    expect(summarize([1])).toBe("1 item");
    expect(summarize([1, 2])).toBe("2 items");
    expect(summarize({ name: "Ann", title: "" })).toBe("Ann");
    expect(summarize({ a: 1, b: "first text" })).toBe("first text");
    expect(summarize({ a: 1 })).toBe("");
    expect(summarize(Symbol("x"))).toBe("");
  });

  it("uses an array's item label", () => {
    const field = fields.array(fields.object({ year: fields.number() }), {
      itemLabel: "year",
    });
    expect(summarize({ year: 2026, title: "T" }, field)).toBe("2026");
    expect(summarize({ title: "T" }, field)).toBe("T");
  });
});

describe("formatting", () => {
  it("formats dates and times in the browser's locale", () => {
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("not a date")).toBe("not a date");
    expect(formatDate("2026-11-17")).toBe(
      new Date(2026, 10, 17).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    );
    const time = new Date("2026-11-17T06:30:00Z");
    const long = time.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    expect(formatDate(time)).toBe(long);
    expect(formatDate("2026-11-17T06:30:00Z")).toBe(long);
  });

  it("formats sizes", () => {
    expect(formatBytes()).toBe("");
    expect(formatBytes(10)).toBe("10 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("makes labels from keys", () => {
    expect(titleCase("publishDate")).toBe("Publish Date");
    expect(titleCase("hero_image")).toBe("Hero image");
  });

  it("turns CSS declarations into a style object", () => {
    expect(
      cssToStyle(
        "color: red; font-weight: 600; --accent: blue; -ms-flex: 1; broken; : x; y:",
      ),
    ).toEqual({
      color: "red",
      fontWeight: "600",
      "--accent": "blue",
      msFlex: "1",
    });
    expect(cssToStyle(undefined)).toEqual({});
  });

  it("makes initials from a name or an address", () => {
    expect(initials("Ann Marie Smith")).toBe("AS");
    expect(initials("seth.georgson@example.org")).toBe("SG");
    expect(initials("ann")).toBe("A");
    expect(initials("")).toBe("?");
  });
});

describe("summarizeProps", () => {
  it("describes a component's props in a line", () => {
    expect(
      summarizeProps({
        empty: "",
        none: null,
        gone: undefined,
        expr: { $raw: "a + b" },
        title: "Hello",
        long: "x".repeat(45),
        one: [1],
        many: [1, 2],
        meta: { name: "Ann" },
        blank: { a: 1 },
        count: 3,
      }),
    ).toBe(
      [
        "expr={…}",
        'title="Hello"',
        `long="${"x".repeat(40)}…"`,
        "one: 1 item",
        "many: 2 items",
        "meta: Ann",
        "blank: {…}",
        "count=3",
      ].join(" · "),
    );
  });
});

describe("inSentence", () => {
  it("lowercases words but keeps acronyms and inner capitals", () => {
    expect(inSentence("Articles")).toBe("articles");
    expect(inSentence("Lectionary Files")).toBe("lectionary files");
    expect(inSentence("FAQs")).toBe("FAQs");
    expect(inSentence("FAQ")).toBe("FAQ");
    expect(inSentence("PDF Downloads")).toBe("PDF downloads");
    expect(inSentence("A")).toBe("a");
  });

  it("judges each part of a hyphenated word, and non-ASCII capitals", () => {
    expect(inSentence("Pre-Service Notes")).toBe("pre-service notes");
    expect(inSentence("COVID-19 Updates")).toBe("COVID-19 updates");
    expect(inSentence("ÉTÉ Notes")).toBe("ÉTÉ notes");
    expect(inSentence("Événements")).toBe("événements");
  });
});

describe("siteHref", () => {
  it("puts one slash between the site and the page's path", () => {
    expect(siteHref("https://example.org", "/a")).toBe("https://example.org/a");
    expect(siteHref("https://example.org/", "/a")).toBe(
      "https://example.org/a",
    );
    expect(siteHref("https://example.org/", "a")).toBe("https://example.org/a");
    expect(siteHref(undefined, "/a")).toBe("/a");
    expect(siteHref(undefined, "a")).toBe("/a");
  });

  it("leaves a path that names its own site as it is", () => {
    expect(siteHref(undefined, "https://other.org/a")).toBe(
      "https://other.org/a",
    );
    expect(siteHref("https://example.org", "https://other.org/a")).toBe(
      "https://other.org/a",
    );
  });

  it("keeps any other path on the site, a colon in it or not", () => {
    expect(siteHref("https://example.org", "note:a")).toBe(
      "https://example.org/note:a",
    );
    expect(siteHref(undefined, "mailto:a@b.org")).toBe("/mailto:a@b.org");
  });
});

describe("gravatarUrl", () => {
  it("hashes the trimmed, lower-cased address with SHA-256", async () => {
    // Gravatar's own example (docs.gravatar.com/rest/hash).
    const url = new URL(
      (await gravatarUrl(" MyEmailAddress@example.com ", "Ann Smith", 64))!,
    );
    expect(url.pathname).toBe(
      "/avatar/84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      s: "64",
      d: "initials",
      name: "Ann Smith",
    });
  });

  it("sends our initials when there is no name", async () => {
    const url = new URL((await gravatarUrl("seth.georgson@x.org", "", 64))!);
    expect(url.searchParams.get("initials")).toBe("SG");
    expect(url.searchParams.has("name")).toBe(false);
  });

  it("is null without an address or Web Crypto", async () => {
    expect(await gravatarUrl("  ", "Ann", 64)).toBeNull();
    vi.stubGlobal("crypto", {});
    try {
      expect(await gravatarUrl("a@b.org", "Ann", 64)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

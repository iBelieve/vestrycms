import { describe, expect, it } from "vitest";
import { collection, defineConfig, fields } from "../src/config/index.js";
import {
  buildDashboard,
  recentCount,
  recentDateField,
} from "../src/core/dashboard.js";
import type { ContentService, EntrySummary } from "../src/core/service.js";
import { SourceError } from "../src/core/source.js";

const config = defineConfig({
  repo: { owner: "o", name: "r", branch: "main" },
  collections: {
    posts: collection({
      label: "Posts",
      path: "src/content/posts/*.md",
      sort: { field: "date", direction: "desc" },
      schema: { title: fields.text(), date: fields.date() },
    }),
    faqs: collection({
      label: "FAQs",
      path: "src/content/faqs/*.md",
      sort: { field: "number", direction: "asc" },
      columns: ["number", "title", "asked"],
      recent: 2,
      schema: {
        number: fields.number(),
        title: fields.text(),
        asked: fields.date(),
      },
    }),
    pages: collection({
      label: "Pages",
      path: "src/pages/*.mdx",
      schema: { title: fields.text() },
    }),
  },
});

const entry = (slug: string, status: EntrySummary["status"] = null) =>
  ({
    slug,
    path: `${slug}.md`,
    sha: "s",
    title: slug,
    data: {},
    status,
  }) satisfies EntrySummary;

function service(lists: Record<string, EntrySummary[] | Error>) {
  return {
    config,
    listEntries: async (key: string) => {
      const list = lists[key];
      if (list instanceof Error) throw list;
      return list;
    },
  } as unknown as ContentService;
}

describe("buildDashboard", () => {
  it("counts entries and drafts and keeps each recent list's length", async () => {
    const posts = Array.from({ length: 7 }, (_, i) =>
      entry(`p${i}`, i < 2 ? "draft" : "published"),
    );
    const dashboard = await buildDashboard(
      service({
        posts,
        faqs: [entry("a"), entry("b"), entry("c")],
        pages: [entry("index")],
      }),
    );
    expect(dashboard.collections.posts).toEqual({
      count: 7,
      drafts: 2,
      recent: posts.slice(0, 5),
    });
    expect(dashboard.collections.faqs).toMatchObject({
      count: 3,
      recent: [{ slug: "a" }, { slug: "b" }],
    });
    expect(dashboard.collections.pages).toEqual({
      count: 1,
      drafts: 0,
      recent: [],
    });
  });

  it("lists a collection not sorted by a date newest first by its date column", async () => {
    const dated = (slug: string, asked: string) => ({
      ...entry(slug),
      data: { asked },
    });
    const dashboard = await buildDashboard(
      service({
        posts: [],
        // In number order; the highest number is not the newest.
        faqs: [
          dated("one", "2025-03-01"),
          dated("two", "2026-02-10"),
          dated("three", "2024-06-01"),
        ],
        pages: [],
      }),
    );
    expect(dashboard.collections.faqs).toMatchObject({
      count: 3,
      recent: [{ slug: "two" }, { slug: "one" }],
    });
  });

  it("lists a collection sorted by date oldest first newest first", async () => {
    const dated = (slug: string, date: string) => ({
      ...entry(slug),
      data: { date },
    });
    const ascending = defineConfig({
      ...config,
      collections: {
        posts: {
          ...config.collections!.posts,
          sort: { field: "date", direction: "asc" },
        },
      },
    });
    const dashboard = await buildDashboard({
      config: ascending,
      listEntries: async () => [
        dated("old", "2024-01-01"),
        dated("mid", "2025-01-01"),
        dated("new", "2026-01-01"),
      ],
    } as unknown as ContentService);
    expect(dashboard.collections.posts).toMatchObject({
      recent: [{ slug: "new" }, { slug: "mid" }, { slug: "old" }],
    });
  });

  it("reports a collection that fails and still loads the others", async () => {
    const dashboard = await buildDashboard(
      service({
        posts: [entry("p")],
        faqs: new Error("Bad frontmatter in faqs/x.md"),
        pages: [],
      }),
    );
    expect(dashboard.collections.faqs).toEqual({
      error: "Bad frontmatter in faqs/x.md",
    });
    expect(dashboard.collections.posts).toMatchObject({ count: 1 });
  });

  it("throws when every collection fails", async () => {
    const down = new SourceError("GitHub is down", 502, "github_error");
    await expect(
      buildDashboard(service({ posts: down, faqs: down, pages: down })),
    ).rejects.toBe(down);
  });
});

describe("recent lists", () => {
  it("follow a date sort by default, or the recent option", () => {
    const { posts, faqs, pages } = config.collections!;
    expect(recentCount(posts)).toBe(5);
    expect(recentCount(faqs)).toBe(2);
    expect(recentCount(pages)).toBe(0);
    expect(recentCount({ ...posts, recent: false })).toBe(0);
    expect(recentCount({ ...pages, recent: true })).toBe(5);
    expect(recentCount({ ...pages, recent: -3 })).toBe(0);
  });

  it("show the sort date, else the first date column", () => {
    const { posts, faqs, pages } = config.collections!;
    expect(recentDateField(posts)).toBe("date");
    expect(recentDateField(faqs)).toBe("asked");
    expect(recentDateField(pages)).toBeNull();
  });
});

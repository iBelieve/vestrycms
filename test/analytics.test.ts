/**
 * Analytics: the Plausible provider (the Stats API queries it sends and the
 * report it builds), the cache, the /analytics route and the config checks.
 */
import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config/validate.js";
import type { VestryConfig } from "../src/config/types.js";
import { analyticsReport } from "../src/core/analytics/index.js";
import {
  PLAUSIBLE_API_KEY,
  previousRange,
  resolvedRange,
  siteHour,
} from "../src/core/analytics/plausible.js";
import { createApi } from "../src/core/api.js";
import { MemoryCache } from "../src/core/cache.js";
import { LocalSource } from "../src/core/sources/local.js";
import { fakePlausible } from "./plausible-fake.js";

const config: VestryConfig = {
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  analytics: {
    provider: "plausible",
    siteId: "example.org",
    host: "https://analytics.example.net/",
  },
};
const env = (key: string) =>
  key === PLAUSIBLE_API_KEY ? "secret-key" : undefined;

function report(
  period: Parameters<typeof analyticsReport>[1] = "7d",
  plausible = fakePlausible(),
  cache = new MemoryCache(),
) {
  return analyticsReport(config, period, {
    env,
    fetch: plausible.fetch,
    cache,
    now: () => new Date("2026-11-20T18:00:00Z"),
  });
}

describe("the Plausible provider", () => {
  it("builds the report from the Stats API", async () => {
    const plausible = fakePlausible();
    const result = await report("7d", plausible);
    expect(result).toMatchObject({
      available: true,
      provider: "plausible",
      period: "7d",
      range: { start: "2026-11-13", end: "2026-11-19" },
      totals: {
        visitors: 150,
        visits: 170,
        pageviews: 260,
        bounceRate: 55.4,
        visitDuration: 95,
      },
      previous: { visitors: 100, pageviews: 200 },
      current: 4,
      interval: "day",
      dashboardUrl: "https://analytics.example.net/example.org",
      generatedAt: "2026-11-20T18:00:00.000Z",
    });
    if (!result.available) throw new Error("unavailable");
    expect(result.pages[0]).toEqual({
      name: "/",
      visitors: 120,
      pageviews: 180,
    });
    expect(result.sources).toEqual([
      { name: "Direct / None", visitors: 90 },
      { name: "Google", visitors: 60 },
    ]);
    expect(result.devices.map((d) => d.name)).toEqual(["Mobile", "Desktop"]);
    // Days nobody visited are filled in from the time labels.
    expect(result.series).toHaveLength(7);
    expect(result.series[1]).toEqual({
      time: "2026-11-14",
      visitors: 0,
      pageviews: 0,
    });
    expect(result.series[2]).toMatchObject({ visitors: 35, pageviews: 50 });
  });

  it("sends the key and the site to the configured server", async () => {
    const plausible = fakePlausible();
    await report("7d", plausible);
    expect(plausible.requests.length).toBe(8);
    for (const r of plausible.requests) {
      expect(r.url.startsWith("https://analytics.example.net/api/")).toBe(true);
      expect(r.authorization).toBe("Bearer secret-key");
    }
    const queries = plausible.requests.flatMap((r) => (r.body ? [r.body] : []));
    expect(queries.every((q) => q.site_id === "example.org")).toBe(true);
    // The previous period: the 7 days before the resolved range.
    expect(queries.map((q) => q.date_range)).toContainEqual([
      "2026-11-06",
      "2026-11-12",
    ]);
    expect(
      queries.find((q) => q.dimensions?.[0] === "event:page")?.pagination,
    ).toEqual({ limit: 10 });
    expect(
      plausible.requests.find((r) => r.url.includes("realtime"))?.url,
    ).toBe(
      "https://analytics.example.net/api/v1/stats/realtime/visitors?site_id=example.org",
    );
  });

  it("charts today by the hour and the months by the month, without comparing today", async () => {
    const day = fakePlausible();
    const today = await report("day", day);
    expect(today).toMatchObject({ interval: "hour", previous: null });
    // Noon in the site's time zone (18:00 UTC at -06:00): later hours are left out.
    if (!today.available) throw new Error("unavailable");
    expect(today.series).toHaveLength(13);
    expect(today.series.at(-1)?.time).toBe("2026-11-20 12:00:00");
    expect(today.series[9]).toMatchObject({ visitors: 6, pageviews: 9 });
    expect(day.requests.map((r) => r.body?.dimensions?.[0])).toContain(
      "time:hour",
    );
    const year = fakePlausible();
    expect(await report("12mo", year)).toMatchObject({ interval: "month" });
    expect(year.requests.map((r) => r.body?.dimensions?.[0])).toContain(
      "time:month",
    );
  });

  it("skips the comparison when the server doesn't echo the range", async () => {
    const plausible = fakePlausible({ noEcho: true });
    expect(await report("7d", plausible)).toMatchObject({
      range: null,
      previous: null,
    });
    expect(plausible.requests.length).toBe(7);
  });

  it("shows no current visitors when the realtime count fails", async () => {
    expect(
      await report("7d", fakePlausible({ realtimeStatus: 500 })),
    ).toMatchObject({ available: true, current: null });
  });

  it("explains a refused key", async () => {
    await expect(
      report(
        "7d",
        fakePlausible({
          fail: { status: 401, body: '{"error":"Invalid API key"}' },
        }),
      ),
    ).rejects.toThrow(
      /Plausible refused the API key in VESTRY_PLAUSIBLE_API_KEY \(HTTP 401\).*example\.org\. Invalid API key/,
    );
  });

  it("says when the server answers something other than a report", async () => {
    const html: typeof fetch = async () =>
      new Response("<!DOCTYPE html><title>Sign in</title>", { status: 200 });
    await expect(
      analyticsReport(config, "7d", {
        env,
        fetch: html,
        cache: new MemoryCache(),
      }),
    ).rejects.toThrow(
      "Plausible at https://analytics.example.net didn't answer with a Stats API report.",
    );
  });

  it("passes other errors along", async () => {
    await expect(
      report("7d", fakePlausible({ fail: { status: 400, body: "nope" } })),
    ).rejects.toThrow("Plausible answered HTTP 400: nope");
  });

  it("says when the server can't be reached", async () => {
    await expect(
      analyticsReport(config, "7d", {
        env,
        fetch: () => Promise.reject(new TypeError("fetch failed")),
        cache: new MemoryCache(),
      }),
    ).rejects.toThrow(
      "Couldn't reach Plausible at https://analytics.example.net: fetch failed",
    );
  });

  it("reuses a recent report", async () => {
    const plausible = fakePlausible();
    const cache = new MemoryCache();
    await report("7d", plausible, cache);
    const count = plausible.requests.length;
    await report("7d", plausible, cache);
    expect(plausible.requests.length).toBe(count);
    await report("30d", plausible, cache);
    expect(plausible.requests.length).toBeGreaterThan(count);
  });

  it("needs the API key", async () => {
    expect(
      await analyticsReport(config, "7d", {
        env: () => undefined,
        fetch: fakePlausible().fetch,
        cache: new MemoryCache(),
      }),
    ).toEqual({
      available: false,
      reason: "setup",
      message:
        "Missing environment variable: VESTRY_PLAUSIBLE_API_KEY (a Plausible Stats API key).",
    });
  });

  it("is off without analytics in the config", async () => {
    expect(
      await analyticsReport({ ...config, analytics: undefined }, "7d", {
        env,
        fetch: fakePlausible().fetch,
        cache: new MemoryCache(),
      }),
    ).toEqual({ available: false, reason: "disabled" });
  });
});

describe("date ranges", () => {
  it("reads the dates out of the resolved range", () => {
    expect(
      resolvedRange(["2026-11-13T00:00:00-06:00", "2026-11-19T23:59:59-06:00"]),
    ).toEqual({ start: "2026-11-13", end: "2026-11-19" });
    expect(resolvedRange(["2026-11-13", "2026-11-19"])).toEqual({
      start: "2026-11-13",
      end: "2026-11-19",
    });
    expect(resolvedRange(undefined)).toBeNull();
    expect(resolvedRange(["2026-11-19", "2026-11-13"])).toBeNull();
    expect(resolvedRange(["soon", "later"])).toBeNull();
  });

  it("finds the hour on the site's clock", () => {
    const now = new Date("2026-11-21T02:30:00Z");
    expect(siteHour(["2026-11-20T00:00:00-06:00", "x"], now)).toBe(
      "2026-11-20 20",
    );
    expect(siteHour(["2026-11-20T00:00:00+05:30", "x"], now)).toBe(
      "2026-11-21 08",
    );
    expect(siteHour(["2026-11-21T00:00:00Z", "x"], now)).toBe("2026-11-21 02");
    expect(siteHour(["2026-11-21", "2026-11-21"], now)).toBeNull();
    expect(siteHour(undefined, now)).toBeNull();
    // The day the clocks go back: from 2 AM the end's offset is the one.
    expect(
      siteHour(
        ["2026-11-01T00:00:00-05:00", "2026-11-01T23:59:59-06:00"],
        new Date("2026-11-01T18:00:00Z"),
      ),
    ).toBe("2026-11-01 12");
  });

  it("compares with as many days just before", () => {
    const range = { start: "2026-10-21", end: "2026-11-19" };
    expect(previousRange("30d", range)).toEqual(["2026-09-21", "2026-10-20"]);
    // Across a leap day and a year boundary.
    expect(
      previousRange("7d", { start: "2028-03-01", end: "2028-03-07" }),
    ).toEqual(["2028-02-23", "2028-02-29"]);
    expect(
      previousRange("7d", { start: "2027-01-03", end: "2027-01-09" }),
    ).toEqual(["2026-12-27", "2027-01-02"]);
    expect(previousRange("day", range)).toBeNull();
    expect(previousRange("7d", null)).toBeNull();
  });

  it("compares the month periods month for month, up to today", () => {
    const sixMonths = { start: "2026-06-01", end: "2026-11-30" };
    // Plausible's range runs to the end of this month; only Nov 1–20 have
    // numbers, so the comparison stops at May 20.
    expect(previousRange("6mo", sixMonths, "2026-11-20")).toEqual([
      "2025-12-01",
      "2026-05-20",
    ]);
    expect(previousRange("6mo", sixMonths)).toEqual([
      "2025-12-01",
      "2026-05-31",
    ]);
    expect(previousRange("6mo", sixMonths, "2026-11-30")).toEqual([
      "2025-12-01",
      "2026-05-31",
    ]);
    expect(
      previousRange(
        "12mo",
        { start: "2025-09-01", end: "2026-08-31" },
        "2026-08-30",
      ),
    ).toEqual(["2024-09-01", "2025-08-30"]);
    // Feb 2026 has no 31st: the day the months land on is clamped.
    expect(
      previousRange(
        "6mo",
        { start: "2026-03-01", end: "2026-08-31" },
        "2026-08-30",
      ),
    ).toEqual(["2025-09-01", "2026-02-28"]);
    // A day range that runs past today is compared over its days so far.
    expect(
      previousRange(
        "7d",
        { start: "2026-11-14", end: "2026-11-20" },
        "2026-11-17",
      ),
    ).toEqual(["2026-11-10", "2026-11-13"]);
    // A range that already ended is compared whole.
    const thirty = { start: "2026-10-21", end: "2026-11-19" };
    expect(previousRange("30d", thirty, "2026-11-20")).toEqual([
      "2026-09-21",
      "2026-10-20",
    ]);
  });
});

describe("the /analytics route", () => {
  const api = (
    options: {
      plausible?: ReturnType<typeof fakePlausible>;
      cfg?: VestryConfig;
    } = {},
  ) =>
    createApi({
      config: options.cfg ?? config,
      index: { builtAt: "", files: {} },
      basePath: "/admin",
      env,
      localSource: new LocalSource("/nonexistent"),
      cache: new MemoryCache(),
      fetch: (options.plausible ?? fakePlausible()).fetch,
    });
  const get = (a: ReturnType<typeof api>, query = "") =>
    a.handle(new Request(`http://vestry.test/admin/api/analytics${query}`));

  it("answers with the report, for the last 7 days by default", async () => {
    const res = await get(api());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ available: true, period: "7d" });
  });

  it("takes a period", async () => {
    const res = await get(api(), "?period=30d");
    expect(await res.json()).toMatchObject({ period: "30d" });
  });

  it("refuses an unknown period", async () => {
    const res = await get(api(), "?period=forever");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { message: "Unknown period: forever", code: "bad_request" },
    });
  });

  it("answers 502 when Plausible fails", async () => {
    const res = await get(
      api({ plausible: fakePlausible({ fail: { status: 500, body: "" } }) }),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { message: "Plausible answered HTTP 500.", code: "analytics" },
    });
  });

  it("says when analytics is off", async () => {
    const res = await get(api({ cfg: { ...config, analytics: undefined } }));
    expect(await res.json()).toEqual({ available: false, reason: "disabled" });
  });

  it("needs sign-in", async () => {
    const res = await createApi({
      config,
      index: { builtAt: "", files: {} },
      basePath: "/admin",
      env,
    }).handle(new Request("http://vestry.test/admin/api/analytics"));
    expect(res.status).toBe(401);
  });
});

describe("analytics config", () => {
  const check = (analytics: unknown) => () =>
    validateConfig({ ...config, analytics } as VestryConfig);

  it("accepts Plausible, with or without a host", () => {
    expect(
      check({ provider: "plausible", siteId: "example.org" }),
    ).not.toThrow();
    expect(check(config.analytics)).not.toThrow();
  });

  it("rejects an unknown provider", () => {
    expect(check({ provider: "umami", siteId: "x" })).toThrow(
      'analytics.provider must be "plausible" (got "umami")',
    );
  });

  it("needs a site id and a URL for the host", () => {
    expect(check({ provider: "plausible" })).toThrow("analytics.siteId");
    expect(check({ provider: "plausible", siteId: " " })).toThrow(
      "analytics.siteId",
    );
    expect(
      check({ provider: "plausible", siteId: "x", host: "analytics.example" }),
    ).toThrow("analytics.host must be the Plausible server's URL");
    expect(check("plausible")).toThrow("analytics must be an object");
  });

  it("keeps the API key off plain http, except on this machine", () => {
    const host = (h: string) =>
      check({ provider: "plausible", siteId: "x", host: h });
    expect(host("http://analytics.example.org")).toThrow("analytics.host");
    expect(host("https://analytics.example.org/?site=x")).toThrow(
      "analytics.host",
    );
    expect(host("http://localhost:8000")).not.toThrow();
    expect(host("http://127.0.0.1:8000")).not.toThrow();
  });
});

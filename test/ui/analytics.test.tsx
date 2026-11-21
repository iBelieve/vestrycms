// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { openPanel } from "./harness.js";
import { defineConfig } from "../../src/config/index.js";
import type { VestryConfig } from "../../src/config/types.js";
import { MemoryCache } from "../../src/core/cache.js";
import {
  bucketLabel,
  change,
  formatCount,
  formatDuration,
  niceScale,
  rangeLabel,
  tickIndexes,
} from "../../src/ui/lib/analytics.js";
import { fakePlausible } from "../plausible-fake.js";

const config = defineConfig({
  name: "Test Site",
  siteUrl: "https://example.org",
  repo: { owner: "o", name: "r", branch: "main" },
  analytics: { provider: "plausible", siteId: "example.org" },
});

function open(
  cfg: VestryConfig = config,
  {
    url = "/",
    key = "secret",
    plausible = fakePlausible(),
  }: {
    url?: string;
    key?: string;
    plausible?: ReturnType<typeof fakePlausible>;
  } = {},
) {
  return openPanel(cfg, {
    url,
    api: {
      env: (k) => (k === "VESTRY_PLAUSIBLE_API_KEY" ? key : undefined),
      fetch: plausible.fetch,
      cache: new MemoryCache(),
    },
  });
}

describe("the dashboard's visitors card", () => {
  it("shows the last 7 days and the top pages", async () => {
    await open();
    expect(await screen.findByText("Visitors, last 7 days")).toBeTruthy();
    const card = (await screen.findByText("Right now")).closest(
      ".v-analytics-widget",
    ) as HTMLElement;
    expect(within(card).getByText("150")).toBeTruthy();
    expect(within(card).getByText("260")).toBeTruthy();
    // 150 visitors against 100 the week before.
    expect(within(card).getByText("+50%")).toBeTruthy();
    const home = within(card).getByRole("link", { name: "/" });
    expect(home.getAttribute("href")).toBe("https://example.org/");
    // The sidebar's link and the card's.
    expect(screen.getAllByRole("link", { name: /Analytics/ })).toHaveLength(2);
  });

  it("is left out without analytics in the config", async () => {
    await open({ ...config, analytics: undefined });
    expect(await screen.findByText(/Local mode/)).toBeTruthy();
    expect(screen.queryByText("Visitors, last 7 days")).toBeNull();
    expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
  });

  it("tells an admin which secret is missing", async () => {
    await open(config, { key: "" });
    expect(await screen.findByText(/VESTRY_PLAUSIBLE_API_KEY/)).toBeTruthy();
  });

  it("says when Plausible fails, without hiding the dashboard", async () => {
    await open(config, {
      plausible: fakePlausible({ fail: { status: 500, body: "" } }),
    });
    expect(
      await screen.findByText(
        "Couldn't load analytics: Plausible answered HTTP 500.",
      ),
    ).toBeTruthy();
  });
});

describe("the Analytics page", () => {
  // Start each test on 30 days, whatever an earlier one chose.
  beforeEach(() => localStorage.clear());

  it("shows the totals, the chart and the breakdowns", async () => {
    await open(config, { url: "/analytics" });
    expect(await screen.findByText("Top sources")).toBeTruthy();
    expect(screen.getByText("Bounce rate")).toBeTruthy();
    expect(screen.getByText("55%")).toBeTruthy();
    expect(screen.getByText("1m 35s")).toBeTruthy();
    expect(screen.getByText("United States")).toBeTruthy();
    expect(screen.getByText("Mobile")).toBeTruthy();
    expect(screen.getByText(/4 visitors right now/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /Open in Plausible/ })
        .getAttribute("href"),
    ).toBe("https://plausible.io/example.org");
    expect(
      screen.getByRole("img", { name: "Visitors over time" }),
    ).toBeTruthy();
  });

  it("switches the period and the charted number", async () => {
    const plausible = fakePlausible();
    await open(config, { url: "/analytics", plausible });
    await screen.findByText("Top sources");
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(await screen.findByText(/Nov 13 – Nov 19, 2026/)).toBeTruthy();
    expect(plausible.requests.some((r) => r.body?.date_range === "7d")).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: /Pageviews/ }));
    expect(
      screen.getByRole("img", { name: "Pageviews over time" }),
    ).toBeTruthy();
  });

  it("keeps the page in place while a new period loads", async () => {
    const plausible = fakePlausible();
    // Hold the 7-day queries until the test lets them through (or ends).
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    onTestFinished(() => release());
    const fetch: typeof plausible.fetch = async (input, init) => {
      if (typeof init?.body === "string" && init.body.includes('"7d"')) {
        await held;
      }
      return plausible.fetch(input, init);
    };
    await open(config, {
      url: "/analytics",
      plausible: { ...plausible, fetch },
    });
    await screen.findByText("Top sources");
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    // The chosen period shows at once, over the last period's numbers.
    expect(await screen.findByText("Last 7 days · Loading…")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "7 days" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("link", { name: /Open in Plausible/ }),
    ).toBeTruthy();
    expect(screen.getByText("Top sources")).toBeTruthy();
    expect(
      document.querySelector(".v-analytics__body")?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(screen.queryByText("Loading analytics…")).toBeNull();
    release();
    expect(await screen.findByText(/Nov 13 – Nov 19, 2026/)).toBeTruthy();
    expect(
      document.querySelector(".v-analytics__body")?.getAttribute("aria-busy"),
    ).toBe("false");
  });

  it("keeps the period buttons, and their focus, when a period fails", async () => {
    const plausible = fakePlausible();
    const fetch: typeof plausible.fetch = async (input, init) =>
      typeof init?.body === "string" && init.body.includes('"7d"')
        ? new Response("", { status: 500 })
        : plausible.fetch(input, init);
    await open(config, {
      url: "/analytics",
      plausible: { ...plausible, fetch },
    });
    await screen.findByText("Top sources");
    const week = screen.getByRole("button", { name: "7 days" });
    week.focus();
    fireEvent.click(week);
    expect(await screen.findByText("Analytics couldn't load")).toBeTruthy();
    expect(screen.queryByText("Top sources")).toBeNull();
    expect(document.activeElement).toBe(week);
    expect(week.getAttribute("aria-pressed")).toBe("true");
  });

  it("goes back to the dashboard without analytics in the config", async () => {
    await open({ ...config, analytics: undefined }, { url: "/analytics" });
    expect(
      await screen.findByText("Dashboard", { selector: "h1 *" }),
    ).toBeTruthy();
  });
});

describe("analytics formatting", () => {
  it("formats counts, durations and changes", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(12_345)).toBe("12.3K");
    expect(formatCount(null)).toBe("–");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(95)).toBe("1m 35s");
    expect(formatDuration(3725)).toBe("1h 02m");
    expect(change("visitors", 150, 100)).toMatchObject({
      label: "+50%",
      good: true,
    });
    expect(change("pageviews", 50, 100)).toMatchObject({
      label: "−50%",
      good: false,
    });
    // Bounce rate moves in points, and down is good.
    expect(change("bounceRate", 55, 60)).toMatchObject({
      label: "−5 pts",
      good: true,
    });
    expect(change("visits", 5, 5)).toMatchObject({ label: "±0%", good: null });
    expect(change("visitors", 5, 0)).toBeNull();
    expect(change("visitors", 5, null)).toBeNull();
  });

  it("labels buckets and ranges", () => {
    expect(bucketLabel("2026-11-20 14:00:00", "hour")).toBe("2 PM");
    expect(bucketLabel("2026-11-20 00:00:00", "hour", true)).toBe(
      "Nov 20, 12 AM",
    );
    expect(bucketLabel("2026-11-20", "day")).toBe("Nov 20");
    expect(bucketLabel("2026-06-01", "month")).toBe("Jun");
    expect(bucketLabel("2026-06-01", "month", true)).toBe("Jun 2026");
    expect(rangeLabel({ start: "2026-11-20", end: "2026-11-20" })).toBe(
      "Nov 20, 2026",
    );
    expect(rangeLabel({ start: "2025-12-01", end: "2026-11-30" })).toBe(
      "Dec 1, 2025 – Nov 30, 2026",
    );
    expect(rangeLabel(null)).toBeNull();
  });

  it("picks round gridlines and spread-out ticks", () => {
    expect(niceScale(0)).toEqual([0, 1]);
    expect(niceScale(37)).toEqual([0, 10, 20, 30, 40]);
    expect(niceScale(180)).toEqual([0, 50, 100, 150, 200]);
    // Counts: whole-number gridlines, never 0.25 or 2.5 apart.
    expect(niceScale(1)).toEqual([0, 1]);
    expect(niceScale(2)).toEqual([0, 1, 2]);
    expect(niceScale(9)).toEqual([0, 5, 10]);
    expect(tickIndexes(3, 5)).toEqual([0, 1, 2]);
    expect(tickIndexes(30, 4)).toEqual([0, 10, 20]);
    expect(tickIndexes(7, 6)).toEqual([0, 2, 4, 6]);
    expect(tickIndexes(0, 4)).toEqual([]);
  });
});

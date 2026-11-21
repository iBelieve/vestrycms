/**
 * Analytics from Google Analytics 4: the service account sign-in, the Data
 * API requests the provider sends, the report it builds from them, and the
 * config checks.
 */
import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config/validate.js";
import type { VestryConfig } from "../src/config/types.js";
import { base64Encode } from "../src/core/source.js";
import { analyticsReport } from "../src/core/analytics/index.js";
import {
  GOOGLE_CREDENTIALS,
  periodRanges,
  zonedNow,
} from "../src/core/analytics/google.js";
import { MemoryCache } from "../src/core/cache.js";
import { fakeGoogle, serviceAccountKey } from "./google-fake.js";

const config: VestryConfig = {
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  analytics: { provider: "google-analytics", propertyId: "123456789" },
};

/** Noon in Chicago on Friday, November 20, 2026. */
const NOW = new Date("2026-11-20T18:00:00Z");

function report(
  period: Parameters<typeof analyticsReport>[1] = "7d",
  {
    google = fakeGoogle(),
    credentials = serviceAccountKey(),
    cfg = config,
  }: {
    google?: ReturnType<typeof fakeGoogle>;
    credentials?: string;
    cfg?: VestryConfig;
  } = {},
) {
  return analyticsReport(cfg, period, {
    env: (key) => (key === GOOGLE_CREDENTIALS ? credentials : undefined),
    fetch: google.fetch,
    cache: new MemoryCache(),
    now: () => NOW,
  });
}

describe("the Google Analytics provider", () => {
  it("builds the report from the Data API", async () => {
    const google = fakeGoogle();
    const result = await report("7d", { google });
    expect(result).toMatchObject({
      available: true,
      provider: "google-analytics",
      period: "7d",
      range: { start: "2026-11-13", end: "2026-11-19" },
      totals: {
        visitors: 150,
        visits: 180,
        pageviews: 260,
        bounceRate: 55,
        visitDuration: 95.4,
      },
      previous: { visitors: 100 },
      current: 4,
      interval: "day",
      pages: [
        { name: "/", visitors: 120, pageviews: 180 },
        { name: "/sermons", visitors: 45, pageviews: 60 },
      ],
      sources: [
        { name: "Direct / None", visitors: 90 },
        { name: "google", visitors: 60 },
      ],
      countries: [{ name: "United States", visitors: 140 }],
      devices: [
        { name: "Mobile", visitors: 100 },
        { name: "Desktop", visitors: 50 },
      ],
      dashboardUrl:
        "https://analytics.google.com/analytics/web/#/p123456789/reports/intelligenthome",
    });
    if (!result.available) throw new Error("no report");
    // Every day of the week, the empty ones as zeros.
    expect(result.series.map((p) => p.time)).toEqual([
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
    ]);
    expect(result.series[0]).toEqual({
      time: "2026-11-13",
      visitors: 10,
      pageviews: 20,
    });
    expect(result.series[1]).toMatchObject({ visitors: 0, pageviews: 0 });

    const totals = google
      .reports()
      .find((r) => r.body?.dateRanges.length === 2)?.body;
    expect(totals).toMatchObject({
      dateRanges: [
        { startDate: "2026-11-13", endDate: "2026-11-19", name: "current" },
        { startDate: "2026-11-06", endDate: "2026-11-12", name: "previous" },
      ],
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "bounceRate" },
        { name: "averageSessionDuration" },
      ],
    });
    expect(
      google.reports().every((r) => r.url.includes("/properties/123456789:")),
    ).toBe(true);
  });

  it("signs in as the service account and reuses the token", async () => {
    const google = fakeGoogle();
    const credentials = serviceAccountKey(
      "reader@example.iam.gserviceaccount.com",
    );
    await report("7d", { google, credentials });
    await report("30d", { google, credentials });
    expect(google.assertions).toHaveLength(1);
    expect(google.assertions[0]).toMatchObject({
      iss: "reader@example.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + 3600,
    });
  });

  it("accepts the key base64-encoded and the property as properties/…", async () => {
    const result = await report("7d", {
      credentials: base64Encode(new TextEncoder().encode(serviceAccountKey())),
      cfg: {
        ...config,
        analytics: {
          provider: "google-analytics",
          propertyId: "properties/123456789",
        },
      },
    });
    expect(result.available).toBe(true);
  });

  it("charts today by the hour, up to now on the property's clock", async () => {
    const result = await report("day");
    if (!result.available) throw new Error("no report");
    expect(result.range).toEqual({ start: "2026-11-20", end: "2026-11-20" });
    expect(result.previous).toBeNull();
    expect(result.interval).toBe("hour");
    // Noon in Chicago: midnight to 12 PM.
    expect(result.series).toHaveLength(13);
    expect(result.series[0]).toEqual({
      time: "2026-11-20 00:00:00",
      visitors: 10,
      pageviews: 20,
    });
    expect(result.series[9]).toMatchObject({ visitors: 11, pageviews: 21 });
    expect(result.series.at(-1)?.time).toBe("2026-11-20 12:00:00");
  });

  it("counts the month periods in calendar months, so far", async () => {
    const google = fakeGoogle();
    const result = await report("6mo", { google });
    if (!result.available) throw new Error("no report");
    expect(result.range).toEqual({ start: "2026-06-01", end: "2026-11-20" });
    expect(result.series.map((p) => p.time)).toEqual([
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
    ]);
    expect(result.series[0]).toMatchObject({ visitors: 10 });
    const totals = google
      .reports()
      .find((r) => r.body?.dateRanges.length === 2)?.body;
    expect(totals?.dateRanges[1]).toMatchObject({
      startDate: "2025-12-01",
      endDate: "2026-05-20",
    });
  });

  it("counts dates in the property's time zone", async () => {
    // 6 PM UTC is already Saturday in Tokyo.
    const result = await report("day", {
      google: fakeGoogle({ timeZone: "Asia/Tokyo" }),
      cfg: {
        ...config,
        analytics: { provider: "google-analytics", propertyId: "555" },
      },
    });
    if (!result.available) throw new Error("no report");
    expect(result.range).toEqual({ start: "2026-11-21", end: "2026-11-21" });
    expect(result.series).toHaveLength(4);
  });

  it("asks for setup when the key is missing or isn't a service account's", async () => {
    expect(await report("7d", { credentials: "" })).toEqual({
      available: false,
      reason: "setup",
      message: expect.stringContaining(GOOGLE_CREDENTIALS),
    });
    expect(await report("7d", { credentials: '{"type":"other"}' })).toEqual({
      available: false,
      reason: "setup",
      message: expect.stringContaining("client_email and private_key"),
    });
  });

  it("says how to grant access when the property refuses", async () => {
    const google = fakeGoogle({
      fail: {
        status: 403,
        body: {
          error: {
            code: 403,
            message:
              "User does not have sufficient permissions for this property.",
            status: "PERMISSION_DENIED",
          },
        },
      },
    });
    await expect(report("7d", { google })).rejects.toThrow(
      /refused vestry@example\.iam\.gserviceaccount\.com access to property 123456789\. Add it as a Viewer/,
    );
  });

  it("passes on what Google says otherwise", async () => {
    await expect(
      report("7d", {
        google: fakeGoogle({
          fail: {
            status: 403,
            body: {
              error: {
                code: 403,
                message:
                  "Google Analytics Data API has not been used in project 42 before or it is disabled.",
                status: "PERMISSION_DENIED",
              },
            },
          },
        }),
      }),
    ).rejects.toThrow(
      "Google Analytics answered HTTP 403: Google Analytics Data API has not been used in project 42 before or it is disabled.",
    );
    await expect(
      report("7d", {
        google: fakeGoogle({
          tokenFail: {
            status: 400,
            body: {
              error: "invalid_grant",
              error_description: "Invalid JWT Signature.",
            },
          },
        }),
      }),
    ).rejects.toThrow(
      `Google refused the service account key in ${GOOGLE_CREDENTIALS} (Invalid JWT Signature.)`,
    );
  });

  it("says what happened when Google answers without JSON", async () => {
    const google = fakeGoogle();
    const answer = (text: string, status: number) =>
      report("7d", {
        google: {
          ...google,
          fetch: (input, init) =>
            String(input).endsWith(":runReport")
              ? Promise.resolve(new Response(text, { status }))
              : google.fetch(input, init),
        },
      });
    await expect(answer("<html>Bad gateway</html>", 502)).rejects.toThrow(
      "Google Analytics answered HTTP 502.",
    );
    await expect(answer("<html>Sign in</html>", 200)).rejects.toThrow(
      "Google Analytics didn't answer with a report.",
    );
  });

  it("gets a new token when Google stops taking the cached one", async () => {
    const credentials = serviceAccountKey();
    await report("7d", { credentials });
    await expect(
      report("7d", {
        credentials,
        google: fakeGoogle({ fail: { status: 401, body: {} } }),
      }),
    ).rejects.toThrow("HTTP 401");
    const google = fakeGoogle();
    await report("7d", { credentials, google });
    expect(google.assertions).toHaveLength(1);
  });

  it("reads a key whose \\n escapes a .env file turned into line breaks", async () => {
    const result = await report("7d", {
      credentials: serviceAccountKey().replace(/\\n/g, "\n"),
    });
    expect(result.available).toBe(true);
  });

  it("leaves out the live count when the realtime report fails", async () => {
    const result = await report("7d", {
      google: fakeGoogle({ realtimeStatus: 500 }),
    });
    expect(result).toMatchObject({ available: true, current: null });
  });

  it("reports a key that isn't an RSA private key", async () => {
    const key = JSON.parse(serviceAccountKey()) as Record<string, string>;
    key.private_key = "not a key";
    await expect(
      report("7d", { credentials: JSON.stringify(key) }),
    ).rejects.toThrow(
      `The private key in ${GOOGLE_CREDENTIALS} is not a PEM-encoded key.`,
    );
  });
});

describe("Google Analytics dates", () => {
  it("covers the same days as Plausible", () => {
    expect(periodRanges("30d", "2026-11-20")).toEqual({
      range: { startDate: "2026-10-21", endDate: "2026-11-19" },
      before: { startDate: "2026-09-21", endDate: "2026-10-20" },
    });
    expect(periodRanges("12mo", "2026-03-31")).toEqual({
      range: { startDate: "2025-04-01", endDate: "2026-03-31" },
      before: { startDate: "2024-04-01", endDate: "2025-03-31" },
    });
    // The same day a year back, or the month's last.
    expect(periodRanges("6mo", "2028-08-31").before).toEqual({
      startDate: "2027-09-01",
      endDate: "2028-02-29",
    });
    // On a month's last day, its months are whole: so are those before.
    expect(periodRanges("6mo", "2026-11-30").before).toEqual({
      startDate: "2025-12-01",
      endDate: "2026-05-31",
    });
    expect(periodRanges("6mo", "2026-11-20").before).toEqual({
      startDate: "2025-12-01",
      endDate: "2026-05-20",
    });
  });

  it("reads the date and hour in a time zone", () => {
    expect(zonedNow(NOW, "America/Chicago")).toEqual({
      date: "2026-11-20",
      hour: "12",
    });
    expect(
      zonedNow(new Date("2026-11-21T05:30:00Z"), "America/Chicago"),
    ).toEqual({ date: "2026-11-20", hour: "23" });
    expect(zonedNow(NOW, "UTC")).toEqual({ date: "2026-11-20", hour: "18" });
  });
});

describe("Google Analytics config", () => {
  const check = (analytics: unknown) => () =>
    validateConfig({ ...config, analytics } as VestryConfig);

  it("takes the property ID", () => {
    expect(
      check({ provider: "google-analytics", propertyId: "123" }),
    ).not.toThrow();
    expect(
      check({ provider: "google-analytics", propertyId: "properties/123" }),
    ).not.toThrow();
  });

  it("refuses a measurement ID or none", () => {
    expect(
      check({ provider: "google-analytics", propertyId: "G-ABC123" }),
    ).toThrow(/not the G-… measurement ID/);
    expect(check({ provider: "google-analytics" })).toThrow(/propertyId/);
    expect(check({ provider: "matomo", siteId: "x" })).toThrow(
      /"plausible" or "google-analytics"/,
    );
  });
});

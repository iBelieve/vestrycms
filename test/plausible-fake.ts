/**
 * A stand-in Plausible server for the analytics tests: answers the Stats API
 * queries Vestry sends with canned numbers, and records each request.
 */

interface FakeRequest {
  url: string;
  method: string;
  authorization: string | null;
  body?: {
    site_id: string;
    metrics: string[];
    date_range: string | [string, string];
    dimensions?: string[];
    include?: { time_labels?: boolean };
    pagination?: { limit: number };
  };
}

export interface FakePlausibleOptions {
  /** Status (and body) to answer every request with instead. */
  fail?: { status: number; body: string };
  /** Answer the realtime count with this status instead. */
  realtimeStatus?: number;
  /** Leave the resolved date range out of the query echo (older servers). */
  noEcho?: boolean;
}

const RANGES: Record<string, [string, string]> = {
  day: ["2026-11-20T00:00:00-06:00", "2026-11-20T23:59:59-06:00"],
  "7d": ["2026-11-13T00:00:00-06:00", "2026-11-19T23:59:59-06:00"],
  "30d": ["2026-10-21T00:00:00-05:00", "2026-11-19T23:59:59-06:00"],
};

const BREAKDOWNS: Record<string, [string, number, number?][]> = {
  "event:page": [
    ["/", 120, 180],
    ["/sermons", 45, 60],
    ["/about", 12, 14],
  ],
  "visit:source": [
    ["Direct / None", 90],
    ["Google", 60],
  ],
  "visit:country_name": [["United States", 140]],
  "visit:device": [
    ["Mobile", 100],
    ["Desktop", 50],
  ],
};

function answer(body: NonNullable<FakeRequest["body"]>, noEcho: boolean) {
  const dimension = body.dimensions?.[0];
  const range = Array.isArray(body.date_range)
    ? body.date_range
    : (RANGES[body.date_range] ?? RANGES["7d"]);
  const query = noEcho ? {} : { date_range: range };
  if (!dimension) {
    // Totals: the previous period (a custom range) had fewer visitors.
    const previous = Array.isArray(body.date_range);
    const metrics = previous
      ? [100, 120, 200, 60, 70]
      : [150, 170, 260, 55.4, 95];
    return { results: [{ metrics, dimensions: [] }], meta: {}, query };
  }
  if (dimension === "time:day") {
    return {
      results: [
        { metrics: [20, 30], dimensions: ["2026-11-13"] },
        { metrics: [35, 50], dimensions: ["2026-11-15"] },
      ],
      meta: body.include?.time_labels
        ? {
            time_labels: [
              "2026-11-13",
              "2026-11-14",
              "2026-11-15",
              "2026-11-16",
              "2026-11-17",
              "2026-11-18",
              "2026-11-19",
            ],
          }
        : {},
      query,
    };
  }
  if (dimension === "time:hour") {
    const hours = Array.from(
      { length: 24 },
      (_, h) => `2026-11-20 ${String(h).padStart(2, "0")}:00:00`,
    );
    return {
      results: [{ metrics: [6, 9], dimensions: [hours[9]] }],
      meta: { time_labels: hours },
      query,
    };
  }
  if (dimension.startsWith("time:"))
    return { results: [], meta: { time_labels: [] }, query };
  return {
    results: (BREAKDOWNS[dimension] ?? []).map(([name, ...metrics]) => ({
      dimensions: [name],
      metrics: metrics.slice(0, body.metrics.length),
    })),
    meta: {},
    query,
  };
}

export function fakePlausible(options: FakePlausibleOptions = {}) {
  const requests: FakeRequest[] = [];
  const fetch: typeof globalThis.fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = String(input);
    const headers = new Headers(init.headers);
    const body = init.body
      ? (JSON.parse(String(init.body)) as FakeRequest["body"])
      : undefined;
    requests.push({
      url,
      method: init.method ?? "GET",
      authorization: headers.get("authorization"),
      body,
    });
    if (options.fail)
      return new Response(options.fail.body, { status: options.fail.status });
    if (url.includes("/api/v1/stats/realtime/visitors")) {
      return options.realtimeStatus
        ? new Response("{}", { status: options.realtimeStatus })
        : Response.json(4);
    }
    return Response.json(answer(body!, options.noEcho ?? false));
  };
  return { fetch, requests };
}

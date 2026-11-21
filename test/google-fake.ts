/**
 * A stand-in for Google for the analytics tests: the OAuth token endpoint
 * (it checks the service account's JWT against its public key) and the
 * GA4 Data API's `runReport` and `runRealtimeReport`, answering with canned
 * numbers and recording each request.
 */
import { generateKeyPairSync, verify } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const PRIVATE_PEM = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

let keys = 0;

/**
 * A service account's JSON key, as Google issues it. Each has its own key
 * id, so the provider's token cache doesn't carry over between tests.
 */
export function serviceAccountKey(
  email = "vestry@example.iam.gserviceaccount.com",
) {
  return JSON.stringify({
    type: "service_account",
    project_id: "example",
    private_key_id: `key-${++keys}`,
    private_key: PRIVATE_PEM,
    client_email: email,
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

interface ReportBody {
  dateRanges: { startDate: string; endDate: string; name?: string }[];
  metrics: { name: string }[];
  dimensions?: { name: string }[];
  limit?: number;
}

export interface FakeGoogleOptions {
  /** The property's time zone, as the Data API reports it. */
  timeZone?: string;
  /** Status and body to answer every Data API request with instead. */
  fail?: { status: number; body: unknown };
  /** Answer the token request with this status and body instead. */
  tokenFail?: { status: number; body: unknown };
  /** Answer the realtime report with this status instead. */
  realtimeStatus?: number;
}

const BREAKDOWNS: Record<string, [string, number, number?][]> = {
  pagePath: [
    ["/", 120, 180],
    ["/sermons", 45, 60],
  ],
  sessionSource: [
    ["(direct)", 90],
    ["google", 60],
  ],
  country: [["United States", 140]],
  deviceCategory: [
    ["mobile", 100],
    ["desktop", 50],
  ],
};

/** A series row for a couple of buckets in the range; the rest are empty. */
function seriesRows(dimension: string, start: string) {
  const [y, m, d] = start.split("-");
  const values: Record<string, string[]> = {
    dateHour: [`${y}${m}${d}00`, `${y}${m}${d}09`],
    date: [`${y}${m}${d}`],
    yearMonth: [`${y}${m}`],
  };
  return (values[dimension] ?? []).map((value, i) => ({
    dimensionValues: [{ value }],
    metricValues: [{ value: String(10 + i) }, { value: String(20 + i) }],
  }));
}

function answer(body: ReportBody, timeZone: string) {
  const dimension = body.dimensions?.[0]?.name;
  const metadata = { timeZone, currencyCode: "USD" };
  if (!dimension) {
    // Totals: as many visitors this period as 150 after one before.
    const row = (visitors: number, name?: string) => ({
      ...(name && { dimensionValues: [{ value: name }] }),
      metricValues: [
        { value: String(visitors) },
        { value: "180" },
        { value: "260" },
        { value: "0.55" },
        { value: "95.4" },
      ],
    });
    const ranges = body.dateRanges;
    return {
      rows:
        ranges.length > 1
          ? [row(100, ranges[1].name), row(150, ranges[0].name)]
          : [row(150)],
      metadata,
    };
  }
  const canned = BREAKDOWNS[dimension];
  if (canned)
    return {
      rows: canned.slice(0, body.limit).map(([value, users, views]) => ({
        dimensionValues: [{ value }],
        metricValues: [
          { value: String(users) },
          ...(views === undefined ? [] : [{ value: String(views) }]),
        ],
      })),
      metadata,
    };
  return {
    rows: seriesRows(dimension, body.dateRanges[0].startDate),
    metadata,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Whether `jwt` is signed by the test key; returns its claims if so. */
function claims(jwt: string): Record<string, unknown> | null {
  const [header, payload, signature] = jwt.split(".");
  const ok = verify(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    publicKey,
    Buffer.from(signature, "base64url"),
  );
  return ok
    ? (JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<
        string,
        unknown
      >)
    : null;
}

export function fakeGoogle(options: FakeGoogleOptions = {}) {
  const timeZone = options.timeZone ?? "America/Chicago";
  const requests: { url: string; body?: ReportBody }[] = [];
  const assertions: Record<string, unknown>[] = [];
  let issued = 0;

  async function token(init: RequestInit | undefined) {
    if (options.tokenFail)
      return json(options.tokenFail.body, options.tokenFail.status);
    const form = new URLSearchParams(String(init?.body ?? ""));
    const jwt = claims(form.get("assertion") ?? "");
    if (
      form.get("grant_type") !==
        "urn:ietf:params:oauth:grant-type:jwt-bearer" ||
      !jwt
    )
      return json(
        { error: "invalid_grant", error_description: "Bad JWT" },
        400,
      );
    assertions.push(jwt);
    return json({
      access_token: `token-${++issued}`,
      expires_in: 3599,
      token_type: "Bearer",
    });
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      requests.push({ url });
      return token(init);
    }
    const body = init?.body
      ? (JSON.parse(String(init.body)) as ReportBody)
      : undefined;
    requests.push({ url, body });
    const auth = new Headers(init?.headers).get("Authorization") ?? "";
    if (!/^Bearer token-\d+$/.test(auth))
      return json({ error: { code: 401, status: "UNAUTHENTICATED" } }, 401);
    if (options.fail) return json(options.fail.body, options.fail.status);
    if (url.endsWith(":runRealtimeReport"))
      return options.realtimeStatus
        ? json({}, options.realtimeStatus)
        : json({ rows: [{ metricValues: [{ value: "4" }] }] });
    if (url.endsWith(":runReport")) return json(answer(body!, timeZone));
    return json({ error: { code: 404, message: "Not found" } }, 404);
  };

  return {
    fetch,
    requests,
    assertions,
    /** The Data API requests, without the token requests. */
    reports: () => requests.filter((r) => r.body),
  };
}

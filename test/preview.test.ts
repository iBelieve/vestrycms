import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_PREVIEW_BYTES,
  PREVIEW_TOKEN_SECONDS,
  previewProblem,
  readPreview,
  signPreviewToken,
  verifyPreviewToken,
} from "../src/core/preview.js";
import { hasPreview, previewModule } from "../src/integration/preview.js";
import { openPreview } from "../src/pages/preview-route.js";
import { auth } from "./preview-stub.js";
import type { VestryConfig } from "../src/config/types.js";

const SECRET = "preview-test-secret";
const entry = { collection: "pages", slug: "about", path: "/about", data: {} };

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://example.org/admin/preview/render", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("preview tokens", () => {
  it("verifies a token it signed until it expires", async () => {
    const now = Date.UTC(2026, 10, 21, 12);
    const { token, expires } = await signPreviewToken(SECRET, now);
    expect(expires).toBe(now + PREVIEW_TOKEN_SECONDS * 1000);
    expect(await verifyPreviewToken(token, SECRET, now)).toBe(true);
    expect(await verifyPreviewToken(token, SECRET, expires - 1)).toBe(true);
    expect(await verifyPreviewToken(token, SECRET, expires)).toBe(false);
  });

  it("refuses another secret's token, a changed expiry and junk", async () => {
    const { token } = await signPreviewToken(SECRET);
    expect(await verifyPreviewToken(token, "another secret")).toBe(false);
    const [expires, signature] = token.split(".");
    const later = `${Number(expires) + 60}.${signature}`;
    expect(await verifyPreviewToken(later, SECRET)).toBe(false);
    expect(await verifyPreviewToken("", SECRET)).toBe(false);
    expect(await verifyPreviewToken("123.***", SECRET)).toBe(false);
    expect(await verifyPreviewToken(`${expires}.`, SECRET)).toBe(false);
  });
});

describe("readPreview", () => {
  const options = { secret: SECRET, collections: ["pages"] };

  it("reads a signed request", async () => {
    const { token } = await signPreviewToken(SECRET);
    const body = ["<p>Hi</p>", { component: "Box", props: {}, children: [] }];
    const read = await readPreview(
      post({ entry, body }, { Authorization: `Bearer ${token}` }),
      options,
    );
    expect(read).toEqual({ entry, body });
  });

  it("needs a token where there is sign-in, and none without", async () => {
    const res = (await readPreview(
      post({ entry, body: [] }),
      options,
    )) as Response;
    expect(res.status).toBe(401);
    const bad = (await readPreview(
      post({ entry, body: [] }, { Authorization: "Bearer 1.abc" }),
      options,
    )) as Response;
    expect(bad.status).toBe(401);
    const local = await readPreview(post({ entry, body: [] }), {
      ...options,
      secret: null,
    });
    expect(local).toEqual({ entry, body: [] });
  });

  it("refuses other methods, oversized bodies and bad JSON", async () => {
    const get = (await readPreview(
      new Request("https://example.org/admin/preview/render"),
      options,
    )) as Response;
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    const local = { ...options, secret: null };
    const big = (await readPreview(
      post("x".repeat(MAX_PREVIEW_BYTES + 1)),
      local,
    )) as Response;
    expect(big.status).toBe(413);
    const declared = (await readPreview(
      post("{}", { "Content-Length": String(MAX_PREVIEW_BYTES + 1) }),
      local,
    )) as Response;
    expect(declared.status).toBe(413);
    const junk = (await readPreview(post("{nope"), local)) as Response;
    expect(junk.status).toBe(400);
    expect(await junk.text()).toBe("The preview is not JSON");
  });
});

describe("previewProblem", () => {
  const check = (value: unknown) => previewProblem(value, ["pages"]);

  it("accepts an entry and nested parts", () => {
    expect(
      check({
        entry,
        body: [
          "<p>",
          {
            component: "Outer",
            props: { a: 1 },
            children: [{ component: "Inner", props: {}, children: null }],
          },
        ],
      }),
    ).toBeNull();
  });

  it("names what is wrong", () => {
    expect(check(null)).toBe("The preview needs an entry");
    expect(check({ entry: { ...entry, collection: "posts" }, body: [] })).toBe(
      'No preview for collection "posts"',
    );
    expect(check({ entry: { ...entry, slug: 1 }, body: [] })).toBe(
      "The entry needs a slug",
    );
    expect(check({ entry: { ...entry, path: 2 }, body: [] })).toBe(
      "The entry's path must be a string or null",
    );
    expect(check({ entry: { ...entry, data: [] }, body: [] })).toBe(
      "The entry's data must be an object",
    );
    expect(check({ entry, body: "<p>" })).toBe(
      "The body must be a list of parts",
    );
    expect(check({ entry, body: [1] })).toBe(
      "Each part of the body is HTML or a component",
    );
    expect(
      check({ entry, body: [{ component: "A", props: null, children: null }] }),
    ).toBe("A component's props must be an object");
    let deep: unknown[] = [];
    const body = deep;
    for (let i = 0; i < 70; i++) {
      const children: unknown[] = [];
      deep.push({ component: "A", props: {}, children });
      deep = children;
    }
    expect(check({ entry, body })).toBe("The body is nested too deeply");
  });
});

describe("openPreview", () => {
  afterEach(() => {
    for (const key of Object.keys(auth))
      delete (auth as Record<string, unknown>)[key];
    Object.assign(auth, { mode: "none" });
    delete process.env.VESTRY_SECRET;
  });

  it("hands over the collection's preview component and the components", async () => {
    const opened = await openPreview(post({ entry, body: ["<p>Hi</p>"] }));
    expect(opened).toMatchObject({
      entry,
      body: ["<p>Hi</p>"],
      Preview: "PagePreview",
      components: {},
    });
  });

  it("checks tokens with dev's secret, or VESTRY_SECRET in a build", async () => {
    Object.assign(auth, { mode: "secret", secret: SECRET });
    const { token } = await signPreviewToken(SECRET);
    const signed = { Authorization: `Bearer ${token}` };
    expect(await openPreview(post({ entry, body: [] }, signed))).toMatchObject({
      entry,
    });
    Object.assign(auth, { mode: "env" });
    const missing = (await openPreview(
      post({ entry, body: [] }, signed),
    )) as Response;
    expect(missing.status).toBe(500);
    process.env.VESTRY_SECRET = SECRET;
    expect(await openPreview(post({ entry, body: [] }, signed))).toMatchObject({
      entry,
    });
    const unsigned = (await openPreview(post({ entry, body: [] }))) as Response;
    expect(unsigned.status).toBe(401);
  });
});

describe("previewModule", () => {
  const config = {
    repo: { owner: "o", name: "r" },
    collections: {
      pages: {
        label: "Pages",
        path: "src/content/pages/*.mdx",
        schema: {},
        preview: "@/previews/Page.astro",
      },
      posts: { label: "Posts", path: "src/content/posts/*.mdx", schema: {} },
    },
    components: {
      Figure: { import: "@/components/Figure.astro" },
      Named: { import: "@/components/index.ts", namedImport: true },
      Missing: { import: "@/components/Missing.astro" },
      Listing: { import: "@/components/Listing.astro", preview: false },
      Global: {},
    },
  } as unknown as VestryConfig;
  const resolve = (specifier: string) =>
    Promise.resolve(
      specifier.includes("Missing") ? null : `/site/src/${specifier.slice(2)}`,
    );

  it("imports the components and previews, by their resolved files", async () => {
    const warnings: string[] = [];
    const source = await previewModule(config, {
      resolve,
      warn: (w) => warnings.push(w),
      auth: { mode: "env" },
    });
    expect(source).toBe(
      [
        'import C0 from "/site/src/components/Figure.astro";',
        'import { Named as C1 } from "/site/src/components/index.ts";',
        'import C2 from "/site/src/previews/Page.astro";',
        'export const components = {"Figure": C0, "Named": C1};',
        'export const previews = {"pages": C2};',
        'export const auth = {"mode":"env"};',
        "",
      ].join("\n"),
    );
    expect(warnings).toEqual([
      "Live preview: can't resolve component Missing (@/components/Missing.astro)",
    ]);
  });

  it("imports nothing when no collection has a preview", async () => {
    const { pages: _, ...rest } = config.collections!;
    const plain = { ...config, collections: rest };
    expect(hasPreview(plain)).toBe(false);
    expect(hasPreview(config)).toBe(true);
    expect(
      await previewModule(plain, {
        resolve,
        warn: () => {},
        auth: { mode: "none" },
      }),
    ).toBe(
      'export const components = {};\nexport const previews = {};\nexport const auth = {"mode":"none"};\n',
    );
  });
});

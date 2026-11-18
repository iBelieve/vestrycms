/**
 * The Astro integration's Node side: its hooks and virtual modules, the dev
 * server bridge, the build-time index and the formatter and logo modules.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import vestry, { collection, defineConfig, fields } from "../src/index.js";
import { buildIndex } from "../src/integration/build-index.js";
import { nodeToFetchHandler } from "../src/integration/dev-middleware.js";
import { formatterModule } from "../src/integration/formatter.js";
import { logoModule } from "../src/integration/logo.js";

const config = defineConfig({
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  collections: {
    posts: collection({
      label: "Posts",
      path: "src/content/posts/**.md",
      schema: { title: fields.text(), tags: fields.array(fields.text()) },
    }),
    links: collection({
      label: "Links",
      path: "src/data/links.yaml",
      schema: { title: fields.text() },
    }),
  },
});

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vestry-integration-"));
  const posts = path.join(root, "src/content/posts");
  await mkdir(path.join(posts, "2026"), { recursive: true });
  await writeFile(
    path.join(posts, "first.md"),
    "---\ntitle: First\ntags:\n  - a\n---\n\n# Hello\n\nSome *text* <b>here</b>.\n",
  );
  await writeFile(
    path.join(posts, "2026/second.md"),
    "---\ntitle: Second\n---\n",
  );
  await writeFile(path.join(posts, "notes.txt"), "not an entry");
  await writeFile(path.join(posts, "broken.md"), "---\ntitle: [\n---\n");
  // A Prettier without the browser build the control panel needs.
  await mkdir(path.join(root, "node_modules/prettier"), { recursive: true });
  await writeFile(
    path.join(root, "node_modules/prettier/package.json"),
    '{ "name": "prettier", "main": "index.js" }',
  );
});

afterAll(() => rm(root, { recursive: true, force: true }));

/** Run a request through a Node server that uses `handler`. */
async function serve(
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => unknown,
  request: (base: string) => Promise<Response>,
): Promise<{ response: Response; nextCalls: unknown[] }> {
  const nextCalls: unknown[] = [];
  const server = createServer((req, res) =>
    handler(req, res, (err) => {
      nextCalls.push(err);
      res.statusCode = 418;
      res.end("next");
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await request(`http://127.0.0.1:${port}`);
    await response.clone().arrayBuffer();
    return { response, nextCalls };
  } finally {
    server.close();
  }
}

describe("nodeToFetchHandler", () => {
  it("passes the request through and writes the response back", async () => {
    const seen: Request[] = [];
    const handler = nodeToFetchHandler(async (request) => {
      seen.push(request);
      const headers = new Headers({ "x-reply": "yes" });
      headers.append("set-cookie", "a=1");
      headers.append("set-cookie", "b=2");
      return new Response(`got ${await request.text()}`, {
        status: 201,
        headers,
      });
    });
    const { response } = await serve(handler, (base) =>
      fetch(`${base}/admin/api/x?y=1`, {
        method: "POST",
        headers: { "x-forwarded-proto": "https", "x-test": "1" },
        body: "hello",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("got hello");
    expect(response.headers.get("x-reply")).toBe("yes");
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(seen[0].url).toMatch(
      /^https:\/\/127\.0\.0\.1:\d+\/admin\/api\/x\?y=1$/,
    );
    expect(seen[0].headers.get("x-test")).toBe("1");
  });

  it("sends a response without a body", async () => {
    const handler = nodeToFetchHandler(
      async () => new Response(null, { status: 304 }),
    );
    const { response } = await serve(handler, (base) => fetch(base));
    expect(response.status).toBe(304);
  });

  it("takes the origin from TLS or HTTP/2, and skips pseudo-headers", async () => {
    const seen: Request[] = [];
    const handler = nodeToFetchHandler(async (request) => {
      seen.push(request);
      return new Response(null, { status: 204 });
    });
    const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    await handler(
      {
        url: "/admin/api/config",
        method: "GET",
        headers: {
          ":method": "GET",
          ":scheme": "https",
          ":authority": "localhost:4321",
          ":path": "/admin/api/config",
          origin: "https://localhost:4321",
        },
        socket: { encrypted: true },
      } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(204);
    expect(seen[0].url).toBe("https://localhost:4321/admin/api/config");
    expect(seen[0].headers.get("origin")).toBe("https://localhost:4321");
  });

  it("hands errors to the next middleware", async () => {
    const failure = new Error("Boom");
    const handler = nodeToFetchHandler(async () => {
      throw failure;
    });
    const { nextCalls } = await serve(handler, (base) => fetch(base));
    expect(nextCalls).toEqual([failure]);
  });
});

describe("buildIndex", () => {
  it("indexes each entry file with its listing data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const index = await buildIndex(root, config);
    expect(Object.keys(index.files).sort()).toEqual([
      "src/content/posts/2026/second.md",
      "src/content/posts/first.md",
    ]);
    expect(index.files["src/content/posts/first.md"]).toMatchObject({
      data: { title: "First" },
      excerpt: "Hello Some text here .",
      hasBody: true,
    });
    expect(index.files["src/content/posts/2026/second.md"]).toMatchObject({
      excerpt: undefined,
      hasBody: false,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/Could not index src\/content\/posts\/broken\.md/),
    );
    warn.mockRestore();
  });

  it("finds nothing in a folder that does not exist", async () => {
    const index = await buildIndex(path.join(root, "missing"), config);
    expect(index.files).toEqual({});
  });
});

describe("formatterModule", () => {
  const noop = `export const available = false;\nexport const ignore = "";\nexport async function formatFile(text) { return text; }\n`;

  it("is a no-op when turned off or without Prettier's browser build", async () => {
    expect(await formatterModule(process.cwd(), false)).toBe(noop);
    expect(await formatterModule(root)).toBe(noop);
  });

  it("formats with the project's Prettier, config and ignore file", async () => {
    const source = await formatterModule(process.cwd());
    expect(source).toContain("export const available = true;");
    expect(source).toMatch(/import \* as prettier from ".*standalone\.mjs";/);
    expect(source).toContain(
      `export const ignore = ${JSON.stringify(
        await import("node:fs").then((fs) =>
          fs.readFileSync(".prettierignore", "utf8"),
        ),
      )};`,
    );
  });
});

describe("logoModule", () => {
  const none = "export default null;\n";

  beforeAll(async () => {
    await mkdir(path.join(root, "src/assets"), { recursive: true });
    await writeFile(path.join(root, "src/assets/logo.svg"), "<svg/>");
  });

  it("bundles a logo file in the project as a build asset", () => {
    const file = path.join(root, "src/assets/logo.svg");
    const source = `import url from ${JSON.stringify(`${file}?url`)};\nexport default url;\n`;
    expect(logoModule(root, "src/assets/logo.svg")).toBe(source);
    expect(logoModule(root, "/src/assets/logo.svg")).toBe(source);
    expect(logoModule(root, "./src/assets/logo.svg")).toBe(source);
  });

  it("leaves a missing file, an absolute URL or no logo to the API", () => {
    expect(logoModule(root, undefined)).toBe(none);
    expect(logoModule(root, "https://example.org/logo.svg")).toBe(none);
    expect(logoModule(root, "src/assets/missing.svg")).toBe(none);
  });

  it("bundles only a file inside the project", () => {
    // A folder would fail the site's build.
    expect(logoModule(root, "src/assets")).toBe(none);
    expect(logoModule(root, "src/assets/")).toBe(none);
    // The file exists, but outside the root the API would serve from.
    expect(
      logoModule(path.join(root, "src/content"), "../assets/logo.svg"),
    ).toBe(none);
  });
});

describe("the integration", () => {
  // The mode comes from the environment unless a test sets it.
  beforeEach(() => vi.stubEnv("VESTRY_MODE", undefined));
  afterEach(() => vi.unstubAllEnvs());

  type Hook = (context: unknown) => void;
  type Plugin = {
    resolveId(id: string): string | null;
    load(id: string): Promise<string | null> | string | null;
    configureServer(server: unknown): void;
  };

  /** Run `astro:config:setup` and return what it registered. */
  function setUp(
    command: "dev" | "build",
    options: Parameters<typeof vestry>[1] = {},
    siteConfig = config,
  ) {
    const integration = vestry(siteConfig, options);
    const registered = {
      plugins: [] as Plugin[],
      routes: [] as { pattern: string; entrypoint: string }[],
      watched: [] as string[],
      logs: [] as string[],
      optimizeDeps: [] as string[],
    };
    (integration.hooks["astro:config:setup"] as Hook)({
      command,
      config: { root: pathToFileURL(`${root}/`) },
      injectRoute: (route: { pattern: string; entrypoint: string }) =>
        registered.routes.push(route),
      updateConfig: (update: {
        vite: { plugins: Plugin[]; optimizeDeps: { include: string[] } };
      }) => {
        registered.plugins.push(...update.vite.plugins);
        registered.optimizeDeps.push(...update.vite.optimizeDeps.include);
      },
      addWatchFile: (file: string) => registered.watched.push(file),
      logger: { info: (line: string) => registered.logs.push(line) },
    });
    return { ...registered, plugin: registered.plugins[0] };
  }

  it("injects the control panel's routes and watches the config file", async () => {
    await writeFile(path.join(root, "vestry.config.ts"), "");
    const { routes, watched, optimizeDeps } = setUp("build", { base: "/cms/" });
    expect(routes.map((r) => r.pattern)).toEqual([
      "/cms/api/[...path]",
      "/cms/[...path]",
    ]);
    expect(watched).toEqual([path.join(root, "vestry.config.ts")]);
    expect(optimizeDeps.every((dep) => dep.startsWith("vestrycms > "))).toBe(
      true,
    );
  });

  it("resolves only its own virtual modules", () => {
    const { plugin } = setUp("build");
    expect(plugin.resolveId("virtual:vestry/config")).toBe(
      "\0virtual:vestry/config",
    );
    expect(plugin.resolveId("virtual:other")).toBe(null);
  });

  it("serves the config, runtime, formatter, logo and index modules", async () => {
    const { plugin } = setUp("build");
    expect(await plugin.load("\0virtual:vestry/config")).toBe(
      `export default ${JSON.stringify(config)};`,
    );
    expect(await plugin.load("\0virtual:vestry/runtime")).toBe(
      `export const basePath = "/admin";\nexport const name = "Test Site";`,
    );
    expect(await plugin.load("\0virtual:vestry/formatter")).toContain(
      "export const available = false;",
    );
    expect(await plugin.load("\0virtual:vestry/logo")).toBe(
      "export default null;\n",
    );
    const index = await plugin.load("\0virtual:vestry/index");
    expect(index).toContain("src/content/posts/first.md");
    expect(await plugin.load("\0virtual:vestry/unknown")).toBe(null);
    expect(await plugin.load("virtual:vestry/config")).toBe(null);
  });

  it("bundles the configured logo from the project root", async () => {
    await mkdir(path.join(root, "src/assets"), { recursive: true });
    await writeFile(path.join(root, "src/assets/logo.svg"), "<svg/>");
    const { plugin } = setUp(
      "build",
      {},
      { ...config, logo: "src/assets/logo.svg" },
    );
    expect(await plugin.load("\0virtual:vestry/logo")).toBe(
      logoModule(root, "src/assets/logo.svg"),
    );
    expect(await plugin.load("\0virtual:vestry/logo")).toContain(
      "src/assets/logo.svg?url",
    );
  });

  it("serves an empty index in dev", async () => {
    const { plugin } = setUp("dev");
    expect(await plugin.load("\0virtual:vestry/index")).toBe(
      `export default {"builtAt":"","files":{}};`,
    );
  });

  /** The dev server middleware `configureServer` adds, if any. */
  function middleware(plugin: Plugin) {
    const added: ((
      req: IncomingMessage,
      res: ServerResponse,
      next: (err?: unknown) => void,
    ) => unknown)[] = [];
    plugin.configureServer({
      middlewares: { use: (fn: never) => added.push(fn) },
    });
    return added[0];
  }

  it("adds no dev server middleware to a build", () => {
    expect(middleware(setUp("build").plugin)).toBeUndefined();
  });

  it("serves the API from the project directory in dev", async () => {
    const { plugin, logs } = setUp("dev");
    const handler = middleware(plugin);
    expect(logs).toEqual([
      "Control panel at /admin (editing local files, no sign-in)",
    ]);
    const api = await serve(handler, (base) =>
      fetch(`${base}/admin/api/config`),
    );
    expect(await api.response.json()).toMatchObject({ mode: "local" });
    const other = await serve(handler, (base) => fetch(`${base}/elsewhere`));
    expect(other.nextCalls).toEqual([undefined]);
  });

  it("goes through GitHub in dev when asked to", () => {
    const { plugin, logs } = setUp("dev", { mode: "github" });
    middleware(plugin);
    expect(logs).toEqual(["Control panel at /admin (GitHub o/r)"]);
  });

  it("keeps dev users in SQLite with sign-in required", async () => {
    vi.stubEnv("VESTRY_MODE", "auth");
    const { plugin, logs } = setUp("dev");
    const handler = middleware(plugin);
    expect(logs).toEqual([
      "Control panel at /admin (editing local files, sign-in required)",
    ]);
    const { response } = await serve(handler, (base) =>
      fetch(`${base}/admin/api/config`),
    );
    expect(await response.json()).toMatchObject({ auth: true, user: null });
  });

  it("checks the config", () => {
    expect(() => vestry({ ...config, repo: { owner: "", name: "" } })).toThrow(
      /repo/,
    );
  });
});

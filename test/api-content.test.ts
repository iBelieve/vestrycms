/**
 * The content routes of the HTTP API in local mode (no sign-in), against the
 * local source in a temporary project directory. The tests share the
 * directory and run in order.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assetContainer,
  collection,
  defineConfig,
  fields,
  singleton,
} from "../src/config/index.js";
import { createApi } from "../src/core/api.js";
import { MailError } from "../src/core/mail.js";
import type { ContentSource } from "../src/core/source.js";
import { SourceError } from "../src/core/source.js";
import { LocalSource } from "../src/core/sources/local.js";

const ORIGIN = "http://vestry.test";
const config = defineConfig({
  repo: { owner: "o", name: "r", branch: "main" },
  logo: "src/assets/brand/logo.svg",
  collections: {
    authors: collection({
      label: "Authors",
      path: "src/content/authors/*.md",
      schema: {
        title: fields.text(),
        photo: fields.image({ directory: "src/assets/people" }),
      },
    }),
    posts: collection({
      label: "Posts",
      path: "src/content/posts/*.md",
      schema: {
        title: fields.text(),
        author: fields.reference({ collection: "authors" }),
        gallery: fields.array(
          fields.object({
            image: fields.image({ directory: "src/assets/gallery" }),
          }),
        ),
      },
    }),
  },
  singletons: {
    site: singleton({
      label: "Site",
      path: "src/data/site.yaml",
      format: "yaml",
      schema: {
        title: fields.text(),
        editor: fields.reference({ collection: "authors" }),
      },
    }),
  },
  assets: {
    images: assetContainer({
      label: "Images",
      directory: "src/assets/images",
      accept: ["png", "jpg"],
    }),
  },
  components: {
    Figure: { props: { src: fields.file({ directory: "public/files" }) } },
  },
});

let root: string;
let api: ReturnType<typeof createApi>;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vestry-api-"));
  await mkdir(path.join(root, "src/assets/brand"), { recursive: true });
  await writeFile(path.join(root, "src/assets/brand/logo.svg"), "<svg/>");
  api = createApi({
    config,
    index: { builtAt: "", files: {} },
    basePath: "/admin",
    env: () => undefined,
    localSource: new LocalSource(root),
  });
});

afterAll(() => rm(root, { recursive: true, force: true }));

async function call<T = unknown>(
  method: string,
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: T; response: Response }> {
  const response = await api.handle(
    new Request(`${ORIGIN}/admin/api${route}`, {
      method,
      headers: { origin: ORIGIN, ...headers },
      body:
        body === undefined
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body),
    }),
  );
  const text = await response.clone().text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON: a served file.
  }
  return { status: response.status, data: data as T, response };
}

type Err = { error: { code: string; message: string } };

describe("routing", () => {
  it("answers 404 outside the API and for unknown routes", async () => {
    const outside = await api.handle(new Request(`${ORIGIN}/elsewhere`));
    expect(outside.status).toBe(404);
    for (const [method, route] of [
      ["GET", "/nothing"],
      ["PATCH", "/collections/posts"],
      ["GET", "/collections/posts/other"],
      ["PATCH", "/collections/posts/entries"],
      ["PATCH", "/collections/posts/entries/a"],
      ["PATCH", "/singletons/site"],
      ["PATCH", "/assets/images"],
    ] as const) {
      const { status, data } = await call<Err>(method, route);
      expect([method, route, status, data.error.code]).toEqual([
        method,
        route,
        404,
        "not_found",
      ]);
    }
  });

  it("refuses a malformed path", async () => {
    const { status, data } = await call<Err>("GET", "/collections/%E0");
    expect(status).toBe(400);
    expect(data.error.code).toBe("bad_request");
  });

  it("refuses writes from another site", async () => {
    const other = await call<Err>(
      "POST",
      "/collections/posts/entries",
      {},
      {
        origin: "http://evil.test",
      },
    );
    expect(other.status).toBe(403);
    const fetchSite = await call<Err>(
      "DELETE",
      "/collections/posts/entries/a",
      undefined,
      { "sec-fetch-site": "cross-site" },
    );
    expect(fetchSite.data.error.code).toBe("cross_site");
  });

  it("does not use sign-in in local mode", async () => {
    const { status, data } = await call<Err>("POST", "/auth/sign-out");
    expect(status).toBe(400);
    expect(data.error.code).toBe("local_mode");
    const users = await call<Err>("GET", "/users");
    expect(users.data.error.code).toBe("local_mode");
  });
});

describe("config and status", () => {
  it("gives the local user and the local source", async () => {
    const { data } = await call<{
      mode: string;
      auth: boolean;
      user: { id: string };
      source: { label: string };
      config: { mail?: unknown; collections?: object };
    }>("GET", "/config");
    expect(data).toMatchObject({ mode: "local", auth: false });
    expect(data.user.id).toBe("local");
    expect(Object.keys(data.config.collections!)).toEqual(["authors", "posts"]);
  });

  it("reports the head", async () => {
    const { data } = await call<{ head: string }>("GET", "/status");
    expect(typeof data.head).toBe("string");
  });
});

describe("entries", () => {
  it("creates, reads, updates and lists them", async () => {
    const created = await call<{ slug: string }>(
      "POST",
      "/collections/authors/entries",
      { data: { title: "Ann" } },
    );
    expect(created.status).toBe(201);
    expect(created.data.slug).toBe("ann");

    await call("POST", "/collections/posts/entries", {
      data: { title: "First", author: "ann" },
    });

    const read = await call<{ data: { title: string } }>(
      "GET",
      "/collections/authors/entries/ann",
    );
    expect(read.data.data.title).toBe("Ann");

    const updated = await call<{ slug: string }>(
      "PUT",
      "/collections/authors/entries/ann",
      { data: { title: "Ann B" } },
    );
    expect(updated.status).toBe(200);

    const list = await call<{ entries: { slug: string; title: string }[] }>(
      "GET",
      "/collections/authors",
    );
    expect(list.data.entries.map((e) => e.title)).toEqual(["Ann B"]);
  });

  it("answers 404 for an entry that does not exist", async () => {
    const { status } = await call("GET", "/collections/authors/entries/nobody");
    expect(status).toBe(404);
  });

  it("finds the entries and singletons that refer to one", async () => {
    await call("PUT", "/singletons/site", {
      data: { title: "Site", editor: "ann" },
    });
    const { data } = await call<{
      references: { kind: string; key: string }[];
    }>("GET", "/collections/authors/references?slug=ann");
    expect(data.references.map((r) => [r.kind, r.key])).toEqual([
      ["collection", "posts"],
      ["singleton", "site"],
    ]);
  });

  it("deletes one", async () => {
    const { status } = await call("DELETE", "/collections/posts/entries/first");
    expect(status).toBe(200);
    const list = await call<{ entries: unknown[] }>(
      "GET",
      "/collections/posts",
    );
    expect(list.data.entries).toEqual([]);
  });
});

describe("singletons", () => {
  it("are read and saved", async () => {
    const { data } = await call<{ data: { title: string }; sha: string }>(
      "GET",
      "/singletons/site",
    );
    expect(data.data.title).toBe("Site");
    await call("PUT", "/singletons/site", {
      data: { title: "Renamed" },
      sha: data.sha,
    });
    expect(await readFile(path.join(root, "src/data/site.yaml"), "utf8")).toBe(
      "title: Renamed\n",
    );
  });

  it("refuse a save over a newer version", async () => {
    const { status, data } = await call<Err>("PUT", "/singletons/site", {
      data: { title: "Stale" },
      sha: "0".repeat(40),
    });
    expect(status).toBe(409);
    expect(data.error.code).toBe("conflict");
  });

  it("start empty before their file exists", async () => {
    await rm(path.join(root, "src/data/site.yaml"));
    const { data } = await call<{ data: object; sha: string }>(
      "GET",
      "/singletons/site",
    );
    expect(data.sha).toBe("");
  });
});

describe("assets", () => {
  const png = Buffer.from("not really a png").toString("base64");

  it("uploads one file, or several, into a folder", async () => {
    const one = await call<{ paths: string[] }>("POST", "/assets/images", {
      files: [{ name: "My Photo.PNG", base64: png }],
    });
    expect(one.status).toBe(201);
    expect(one.data.paths).toEqual(["src/assets/images/my-photo.png"]);
    const two = await call<{ paths: string[] }>(
      "POST",
      "/assets/images?dir=old",
      {
        files: [
          { name: "a.png", base64: png },
          { name: "b.jpg", base64: png },
        ],
      },
    );
    expect(two.data.paths).toEqual([
      "src/assets/images/old/a.png",
      "src/assets/images/old/b.jpg",
    ]);
  });

  it("refuses a file type the container does not accept", async () => {
    const { status, data } = await call<Err>("POST", "/assets/images", {
      dir: "",
      files: [{ name: "notes.txt", base64: png }],
    });
    expect(status).toBe(400);
    expect(data.error.code).toBe("validation");
  });

  it("lists files and folders, skipping hidden files", async () => {
    await writeFile(path.join(root, "src/assets/images/.hidden"), "");
    const { data } = await call<{
      items: { name: string; kind: string }[];
      folders: string[];
    }>("GET", "/assets/images");
    expect(data.items).toEqual([
      expect.objectContaining({ name: "my-photo.png", kind: "image" }),
    ]);
    expect(data.folders).toEqual(["old"]);
  });

  it("refuses a folder outside the container", async () => {
    const { status } = await call("GET", "/assets/images?dir=../../secrets");
    expect(status).toBe(400);
  });

  it("deletes a file, but only inside the container", async () => {
    const outside = await call<Err>("DELETE", "/assets/images", {
      path: "src/content/posts/x.md",
    });
    expect(outside.data.error.code).toBe("bad_path");
    const { status } = await call("DELETE", "/assets/images", {
      path: "src/assets/images/old/a.png",
    });
    expect(status).toBe(200);
    const list = await call<{ items: unknown[] }>(
      "GET",
      "/assets/images?dir=old",
    );
    expect(list.data.items).toHaveLength(1);
  });
});

describe("files", () => {
  it("serves a file from an asset container, with an ETag", async () => {
    const { status, response } = await call(
      "GET",
      "/file?path=src/assets/images/my-photo.png",
    );
    expect(status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const etag = response.headers.get("etag")!;
    const again = await call(
      "GET",
      "/file?path=src/assets/images/my-photo.png",
      undefined,
      { "if-none-match": etag },
    );
    expect(again.status).toBe(304);
  });

  it("lets the browser keep a file whose URL names its blob SHA", async () => {
    const list = await call<{ items: { path: string; sha: string }[] }>(
      "GET",
      "/assets/images?dir=",
    );
    const photo = list.data.items.find((i) => i.path.endsWith("my-photo.png"))!;
    const pinned = await call("GET", `/file?path=${photo.path}&v=${photo.sha}`);
    expect(pinned.response.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    const plain = await call("GET", `/file?path=${photo.path}`);
    expect(plain.response.headers.get("cache-control")).toBe(
      "private, max-age=0, must-revalidate",
    );
    // A URL made before the file changed must not be kept for the new bytes.
    const stale = await call("GET", `/file?path=${photo.path}&v=0123abc`);
    expect(stale.status).toBe(200);
    expect(stale.response.headers.get("cache-control")).toBe(
      "private, max-age=0, must-revalidate",
    );
  });

  it("serves the logo", async () => {
    const { data, response } = await call(
      "GET",
      "/file?path=./src/assets/brand/logo.svg",
    );
    expect(data).toBe("<svg/>");
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
  });

  it("serves files from image and file fields' folders, at any depth", async () => {
    for (const dir of [
      "src/assets/people",
      "src/assets/gallery",
      "public/files",
    ]) {
      await mkdir(path.join(root, dir), { recursive: true });
      await writeFile(path.join(root, dir, "x.bin"), "x");
      const { status, response } = await call("GET", `/file?path=${dir}/x.bin`);
      expect([dir, status]).toEqual([dir, 200]);
      expect(response.headers.get("content-type")).toBe(
        "application/octet-stream",
      );
    }
  });

  it("refuses other paths", async () => {
    expect((await call("GET", "/file")).status).toBe(400);
    expect((await call("GET", "/file?path=src/content/x.md")).status).toBe(403);
    expect((await call("GET", "/file?path=../etc/passwd")).status).toBe(400);
    expect(
      (await call("GET", "/file?path=src/assets/images/none.png")).status,
    ).toBe(404);
  });
});

describe("dashboard", () => {
  it("answers every collection's counts in one request", async () => {
    const { status, data } = await call<{
      collections: Record<string, { count: number; drafts: number }>;
    }>("GET", "/dashboard");
    expect(status).toBe(200);
    expect(Object.keys(data.collections)).toEqual(["authors", "posts"]);
    for (const key of ["authors", "posts"]) {
      const list = await call<{ entries: unknown[] }>(
        "GET",
        `/collections/${key}`,
      );
      expect(data.collections[key].count).toBe(list.data.entries.length);
    }
  });
});

describe("errors", () => {
  it("reports a request body that is not JSON", async () => {
    const { status, data } = await call<Err>(
      "POST",
      "/collections/posts/entries",
      "{",
    );
    expect(status).toBe(400);
    expect(data.error.code).toBe("bad_request");
  });

  /** An API whose source fails every read with `failure`. */
  const failing = (failure: unknown) => {
    const source: ContentSource = {
      info: () => ({ kind: "local", label: "failing" }),
      head: async () => "head",
      list: async () => {
        throw failure;
      },
      read: async () => {
        throw failure;
      },
      commit: async () => {
        throw failure;
      },
    };
    return createApi({
      config,
      index: { builtAt: "", files: {} },
      basePath: "/admin",
      env: () => undefined,
      localSource: source,
    });
  };
  const listPosts = async (failure: unknown) => {
    const response = await failing(failure).handle(
      new Request(`${ORIGIN}/admin/api/collections/posts`),
    );
    return { status: response.status, body: (await response.json()) as Err };
  };

  it("passes on a source's status and code", async () => {
    expect(await listPosts(new SourceError("Gone", 410, "gone"))).toEqual({
      status: 410,
      body: { error: { message: "Gone", code: "gone" } },
    });
  });

  it("reports a mail failure as a bad gateway", async () => {
    expect((await listPosts(new MailError("No mail"))).status).toBe(502);
  });

  it("reports anything else as an internal error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await listPosts(new Error("Boom"))).toEqual({
      status: 500,
      body: { error: { message: "Boom", code: "internal" } },
    });
    expect((await listPosts("a string")).body.error.message).toBe(
      "Unexpected error",
    );
    // Only a request body that is not JSON is the client's mistake.
    expect(
      await listPosts(new SyntaxError("Unexpected token in links.json")),
    ).toMatchObject({ status: 500, body: { error: { code: "internal" } } });
    log.mockRestore();
  });
});

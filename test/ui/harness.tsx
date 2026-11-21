/**
 * Renders the control panel in jsdom against the real HTTP API: `fetch` is
 * routed to `createApi`'s handler, editing a temporary project directory in
 * local mode (or with sign-in, given `auth`). Import this before anything
 * from `src/ui` in a test with `// @vitest-environment jsdom`.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, vi } from "vitest";
import type { VestryConfig } from "../../src/config/types.js";
import { createApi, type ApiOptions } from "../../src/core/api.js";
import { memoryMailer } from "../../src/core/mail.js";
import { LocalSource } from "../../src/core/sources/local.js";
import { App } from "../../src/ui/App.js";

// What jsdom leaves out and the editors and dialogs use.
class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver ??= Observer as never;
globalThis.IntersectionObserver ??= Observer as never;
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as never;
const emptyRects = () => Object.assign([], { item: () => null }) as never;
const emptyRect = () => new DOMRect(0, 0, 0, 0);
Range.prototype.getClientRects ??= emptyRects;
Range.prototype.getBoundingClientRect ??= emptyRect;
Element.prototype.scrollIntoView ??= () => {};
HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
document.elementFromPoint ??= () => null;
URL.createObjectURL ??= (blob: Blob) => `blob:${(blob as File).name ?? "file"}`;
URL.revokeObjectURL ??= () => {};

const ORIGIN = window.location.origin;

/** A project directory with these files (paths relative to it). */
async function project(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vestry-ui-"));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return root;
}

/** A list of files, as a file input or a drop holds them. */
export function fileList(...files: File[]): FileList {
  return Object.assign([...files], {
    item: (i: number) => files[i] ?? null,
  });
}

/** Picks `files` in a file input. */
export function pickFiles(input: HTMLInputElement, ...files: File[]) {
  Object.defineProperty(input, "files", {
    value: fileList(...files),
    configurable: true,
  });
  fireEvent.change(input);
}

const roots: string[] = [];
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Sign-in on Better Auth's memory adapter, with a mailer that keeps what it sends. */
export function signIn() {
  const mailer = memoryMailer();
  return {
    mailer,
    /** The sign-in code in the last email sent. */
    lastCode: () =>
      /(\d{3}) (\d{3})/.exec(mailer.sent.at(-1)!.text)!.slice(1).join(""),
    options: {
      database: memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
        rateLimit: [],
      }),
      mailer,
      secret: "test-secret-test-secret-test-secret-1234",
      required: true,
      dev: true,
      migrate: false,
    },
  };
}

/**
 * Open the control panel at `url` (below `/admin`), on a project with
 * `files`. Returns the project directory and every API request made.
 * Cookies the API sets are kept and sent back, like a browser's.
 */
export async function openPanel(
  config: VestryConfig,
  {
    url = "/",
    files = {},
    api: apiOptions = {},
    site,
  }: {
    url?: string;
    files?: Record<string, string>;
    api?: Partial<ApiOptions>;
    /** Answers requests outside the API, such as the preview route's. */
    site?: (request: Request) => Promise<Response> | Response;
  } = {},
) {
  const root = await project(files);
  roots.push(root);
  const api = createApi({
    config,
    index: { builtAt: "", files: {} },
    basePath: "/admin",
    env: () => undefined,
    localSource: new LocalSource(root),
    ...apiOptions,
  });
  const requests: { method: string; url: string; body?: unknown }[] = [];
  const cookies = new Map<string, string>();
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const given = new Request(
        new URL(input instanceof Request ? input.url : String(input), ORIGIN),
        input instanceof Request ? input : init,
      );
      const headers = new Headers(given.headers);
      headers.set("origin", ORIGIN);
      if (cookies.size)
        headers.set(
          "cookie",
          [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        );
      const request = new Request(given, { headers });
      const text = request.method === "GET" ? "" : await request.clone().text();
      requests.push({
        method: request.method,
        url: request.url.slice(ORIGIN.length),
        body: text ? JSON.parse(text) : undefined,
      });
      const response =
        site && !new URL(request.url).pathname.startsWith("/admin/api/")
          ? await site(request)
          : await api.handle(request);
      for (const cookie of response.headers.getSetCookie()) {
        const [pair, ...attrs] = cookie.split(";");
        // A value may hold "=" itself (base64 padding).
        const eq = pair.indexOf("=");
        const name = eq === -1 ? pair : pair.slice(0, eq);
        const value = eq === -1 ? "" : pair.slice(eq + 1);
        if (attrs.some((a) => /max-age=0/i.test(a)))
          cookies.delete(name.trim());
        else cookies.set(name.trim(), value);
      }
      return response;
    },
  );
  window.history.replaceState(null, "", `/admin${url === "/" ? "" : url}`);
  const view = render(<App basePath="/admin" name="Vestry" />);
  return { root, requests, view };
}

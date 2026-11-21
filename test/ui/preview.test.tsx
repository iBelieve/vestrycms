// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openPanel } from "./harness.js";
import { collection, defineConfig, fields } from "../../src/config/index.js";
import type {
  PreviewMessage,
  PreviewSnapshot,
} from "../../src/ui/lib/preview-channel.js";

const config = defineConfig({
  name: "Test Site",
  siteUrl: "https://example.org",
  repo: { owner: "o", name: "r", branch: "main" },
  collections: {
    pages: collection({
      label: "Pages",
      path: "src/content/pages/*.mdx",
      previewUrl: "/{slug}",
      preview: "@/components/PagePreview.astro",
      schema: { title: fields.text({ required: true }) },
    }),
    notes: collection({
      label: "Notes",
      path: "src/content/notes/*.md",
      schema: { title: fields.text() },
    }),
  },
});

const files = {
  "src/content/pages/about.mdx":
    "---\ntitle: About us\n---\n\nHello ![](./cat.jpg)\n",
  "src/content/notes/one.md": "---\ntitle: One\n---\n\nA note.\n",
};

/** The other end of the preview channel, and what it has heard. */
function listen() {
  const channel = new BroadcastChannel("vestry-preview:/admin");
  const heard: PreviewMessage[] = [];
  channel.onmessage = ({ data }: MessageEvent) =>
    heard.push(data as PreviewMessage);
  channels.push(channel);
  return { channel, heard };
}
const channels: BroadcastChannel[] = [];
afterEach(() => {
  for (const c of channels.splice(0)) c.close();
});

const snapshot = (over: Partial<PreviewSnapshot> = {}): PreviewSnapshot => ({
  collection: "pages",
  slug: "about",
  filePath: "src/content/pages/about.mdx",
  path: "/about",
  title: "About us",
  data: { title: "About us" },
  body: "Hello ![](./cat.jpg)\n",
  uploads: {},
  ...over,
});

describe("the editor's Preview button", () => {
  it("opens the preview window and sends it the entry as it changes", async () => {
    const popup = { location: { href: "about:blank" }, focus: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as never);
    const { heard } = listen();
    await openPanel(config, { url: "/collections/pages/about", files });
    await userEvent.click(
      await screen.findByRole("button", { name: /Preview/ }),
    );
    expect(open).toHaveBeenCalledWith(
      "",
      "vestry-preview",
      "popup,width=1280,height=900",
    );
    expect(popup.location.href).toBe("/admin/preview");
    await waitFor(() =>
      expect(heard.some((m) => m.type === "entry")).toBe(true),
    );
    expect(heard.find((m) => m.type === "entry")).toEqual({
      type: "entry",
      snapshot: snapshot(),
    });

    heard.length = 0;
    const title = screen.getByRole("textbox", { name: /Title/ });
    await userEvent.type(title, "!");
    await waitFor(() =>
      expect(heard.at(-1)).toMatchObject({
        type: "entry",
        snapshot: { title: "About us!", data: { title: "About us!" } },
      }),
    );
    open.mockRestore();
  });

  it("answers a window that opens, until it closes", async () => {
    const { channel, heard } = listen();
    await openPanel(config, { url: "/collections/pages/about", files });
    await screen.findByRole("button", { name: /Preview/ });
    await waitFor(() => expect(heard).toContainEqual({ type: "who" }));
    expect(heard.some((m) => m.type === "entry")).toBe(false);
    channel.postMessage({ type: "hello" });
    await waitFor(() =>
      expect(heard.at(-1)).toEqual({ type: "entry", snapshot: snapshot() }),
    );
    channel.postMessage({ type: "bye" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    heard.length = 0;
    await userEvent.type(screen.getByRole("textbox", { name: /Title/ }), "!");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(heard).toEqual([]);
  });

  it("sends a window it opened its entry, though the window hides its tab", async () => {
    const popup = { location: { href: "about:blank" }, focus: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as never);
    const { channel, heard } = listen();
    await openPanel(config, { url: "/collections/pages/about", files });
    await userEvent.click(
      await screen.findByRole("button", { name: /Preview/ }),
    );
    // The new window covers the editor's, whose tab is then out of view.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    try {
      heard.length = 0;
      channel.postMessage({ type: "hello" });
      await waitFor(() =>
        expect(heard.at(-1)).toEqual({ type: "entry", snapshot: snapshot() }),
      );
      // Only once: after that, the editor in view answers.
      heard.length = 0;
      channel.postMessage({ type: "hello" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(heard).toEqual([]);
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
      open.mockRestore();
    }
  });

  it("is not there for a collection without a preview", async () => {
    await openPanel(config, { url: "/collections/notes/one", files });
    await screen.findByRole("button", { name: /Save/ });
    expect(screen.queryByRole("button", { name: /Preview/ })).toBeNull();
  });
});

describe("the preview window", () => {
  it("draws the entries it is sent, keeping the last page if a redraw fails", async () => {
    const { channel, heard } = listen();
    const drawn: { body: unknown; auth: string | null }[] = [];
    let fail = false;
    const { requests } = await openPanel(config, {
      url: "/preview",
      files,
      site: async (request) => {
        expect(new URL(request.url).pathname).toBe("/admin/preview/render");
        drawn.push({
          body: await request.json(),
          auth: request.headers.get("authorization"),
        });
        return fail
          ? new Response("BiblePassage: no such book", {
              status: 500,
              headers: { "Content-Type": "text/plain" },
            })
          : new Response(
              `<!doctype html><html><head><title>t</title></head><body>Page ${drawn.length}</body></html>`,
              { headers: { "Content-Type": "text/html" } },
            );
      },
    });
    expect(await screen.findByText("Waiting for the editor")).toBeTruthy();
    await waitFor(() => expect(heard).toContainEqual({ type: "hello" }));

    channel.postMessage({ type: "entry", snapshot: snapshot() });
    await waitFor(() => expect(drawn).toHaveLength(1));
    // Local mode has no sign-in, so the token is null.
    expect(requests.some((r) => r.url === "/admin/api/preview/token")).toBe(
      true,
    );
    expect(drawn[0]).toEqual({
      auth: null,
      body: {
        entry: {
          collection: "pages",
          slug: "about",
          path: "/about",
          data: { title: "About us" },
        },
        body: [
          `<p>Hello <img src="/admin/api/file?path=${encodeURIComponent("src/content/pages/cat.jpg")}" alt=""></p>`,
        ],
      },
    });
    const next = await waitFor(() => {
      const frame = document.querySelector<HTMLIFrameElement>(
        "iframe:not([data-front])",
      );
      expect(frame?.srcdoc).toContain("Page 1");
      return frame!;
    });
    expect(next.srcdoc).toContain(
      `<head><base href="${window.location.origin}/about">`,
    );
    fireEvent.load(next);
    expect(next.hasAttribute("data-front")).toBe(true);
    expect(document.title).toBe("Preview: About us");

    // Links in the page scroll it or open the live site; forms don't send.
    const page = next.contentWindow!.document;
    page.body.innerHTML =
      '<a href="#note">1</a><p id="note">Note</p><a href="/visit"><b>Visit</b></a><form><button>Send</button></form>';
    const scroll = vi.fn();
    page.getElementById("note")!.scrollIntoView = scroll;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    page.querySelector<HTMLElement>('a[href="#note"]')!.click();
    expect(scroll).toHaveBeenCalled();
    page.querySelector("b")!.click();
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\/visit$/),
      "_blank",
      "noopener",
    );
    const submit = new Event("submit", { cancelable: true, bubbles: true });
    page.querySelector("form")!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    open.mockRestore();
    expect(screen.getByText("/about")).toBeTruthy();

    fail = true;
    channel.postMessage({
      type: "entry",
      snapshot: snapshot({ body: "<BiblePassage />" }),
    });
    expect(
      await screen.findByText("Couldn't update: BiblePassage: no such book"),
    ).toBeTruthy();
    expect(next.hasAttribute("data-front")).toBe(true);

    // An editor opened later finds the window.
    channel.postMessage({ type: "who" });
    await waitFor(() =>
      expect(heard.filter((m) => m.type === "hello")).toHaveLength(2),
    );
  });

  it("remembers the width it was set to", async () => {
    await openPanel(config, { url: "/preview", files });
    await userEvent.click(await screen.findByRole("button", { name: "Phone" }));
    expect(localStorage.getItem("vestry:preview-width")).toBe("phone");
    expect(
      screen
        .getByRole("button", { name: "Phone" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

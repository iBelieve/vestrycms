import { Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { VestryConfig } from "../../config/types.js";
import { collectionFormat } from "../../core/paths.js";
import { assetsToStored } from "../../core/values.js";
import type { PreviewRequest } from "../../core/preview.js";
import type { ApiClient } from "../api.js";
import type { PendingUpload } from "../components/AssetPicker.js";
import { EmptyState, Segment, Spinner } from "../components/ui.js";
import { useVestry } from "../context.js";
import { previewBody } from "../lib/preview-body.js";
import {
  isPreviewMessage,
  previewChannel,
  type PreviewMessage,
  type PreviewSnapshot,
} from "../lib/preview-channel.js";
import { bodyEnv } from "./entry-editing.js";

const WIDTHS = { phone: 390, tablet: 820, desktop: null } as const;
type Width = keyof typeof WIDTHS;
const WIDTH_NAMES = Object.keys(WIDTHS) as Width[];
const WIDTH_KEY = "vestry:preview-width";

/**
 * The live preview window: the entry an editor sends (see
 * `preview-channel.ts`), drawn by the site's preview route, redrawn as it
 * changes. It keeps the last page it drew when a redraw fails.
 */
export function PreviewPage() {
  const snapshot = usePreviewSnapshot();
  const render = usePreviewRender(snapshot);
  const [width, setWidth] = useStoredWidth();
  useEffect(() => {
    document.title = snapshot?.title ? `Preview: ${snapshot.title}` : "Preview";
  }, [snapshot?.title]);

  return (
    <div className="v-preview">
      <header className="v-preview__bar">
        <div className="v-preview__entry">
          <Eye size={16} aria-hidden />
          <strong>{snapshot?.title || "Preview"}</strong>
          {snapshot?.path && (
            <span className="v-preview__path">{snapshot.path}</span>
          )}
        </div>
        <Segment
          label="Width"
          options={WIDTH_NAMES}
          value={width}
          onChange={setWidth}
        />
        <PreviewStatus render={render} />
      </header>
      <main className="v-preview__stage">
        {render.page ? (
          <PreviewFrame page={render.page} width={WIDTHS[width]} />
        ) : (
          <PreviewEmpty waiting={!snapshot} render={render} />
        )}
      </main>
    </div>
  );
}

/** Before the first page is drawn: waiting for an entry, drawing it, or failing to. */
function PreviewEmpty({
  waiting,
  render,
}: {
  waiting: boolean;
  render: PreviewRender;
}) {
  if (waiting)
    return (
      <EmptyState icon={<Eye size={28} />} title="Waiting for the editor">
        Choose Preview in an entry's editor, and the page shows here as you edit
        it.
      </EmptyState>
    );
  const failed = render.error !== null && !render.busy;
  return (
    <EmptyState
      icon={failed ? <Eye size={28} /> : <Spinner />}
      title={failed ? "Couldn't draw the page" : "Drawing the page…"}
    >
      {render.error && <p>{render.error}</p>}
    </EmptyState>
  );
}

function PreviewStatus({ render }: { render: PreviewRender }) {
  if (render.error && render.page)
    return (
      <span className="v-preview__status is-error" role="status">
        {`Couldn't update: ${render.error}`}
      </span>
    );
  return (
    <span className="v-preview__status" role="status">
      {render.busy && (
        <>
          <Spinner /> Updating…
        </>
      )}
    </span>
  );
}

function useStoredWidth(): [Width, (width: Width) => void] {
  const [width, setWidth] = useState<Width>(() => {
    try {
      const stored = localStorage.getItem(WIDTH_KEY);
      return WIDTH_NAMES.includes(stored as Width)
        ? (stored as Width)
        : "desktop";
    } catch {
      return "desktop";
    }
  });
  return [
    width,
    (next) => {
      setWidth(next);
      try {
        localStorage.setItem(WIDTH_KEY, next);
      } catch {
        // Kept for this window only.
      }
    },
  ];
}

/** The entry the editors last sent; null until one does. */
function usePreviewSnapshot(): PreviewSnapshot | null {
  const { basePath } = useVestry();
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);
  useEffect(() => {
    const channel = previewChannel(basePath);
    if (!channel) return;
    const say = (message: PreviewMessage) => channel.postMessage(message);
    channel.onmessage = ({ data }: MessageEvent) => {
      if (!isPreviewMessage(data)) return;
      if (data.type === "who") say({ type: "hello" });
      if (data.type === "entry") setSnapshot(data.snapshot);
    };
    say({ type: "hello" });
    const bye = () => say({ type: "bye" });
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("pagehide", bye);
      bye();
      channel.close();
    };
  }, [basePath]);
  return snapshot;
}

/** A drawn page, and which entry it is of. */
interface PreviewedPage {
  html: string;
  /** The entry, so that its scroll position is kept across redraws. */
  entry: string;
  path: string | null;
}

interface PreviewRender {
  page: PreviewedPage | null;
  busy: boolean;
  error: string | null;
}

/**
 * Draws each snapshot through the preview route, one request at a time:
 * changes made while one is drawing wait, and only the newest is drawn.
 */
function usePreviewRender(snapshot: PreviewSnapshot | null): PreviewRender {
  const { api, basePath, config } = useVestry();
  const [state, setState] = useState<PreviewRender>({
    page: null,
    busy: false,
    error: null,
  });
  const queue = useRef<{ running: boolean; next: PreviewSnapshot | null }>({
    running: false,
    next: null,
  });
  const token = useRef(previewTokens(api));

  useEffect(() => {
    if (!snapshot) return;
    const q = queue.current;
    q.next = snapshot;
    if (q.running) return;
    q.running = true;
    setState((s) => ({ ...s, busy: true }));
    void (async () => {
      while (q.next) {
        const current = q.next;
        q.next = null;
        try {
          const html = await drawPreview({
            snapshot: current,
            config,
            api,
            basePath,
            token: token.current,
          });
          setState((s) => ({
            ...s,
            error: null,
            page: {
              html,
              entry: `${current.collection}/${current.slug}`,
              path: current.path,
            },
          }));
        } catch (e) {
          setState((s) => ({
            ...s,
            error: e instanceof Error ? e.message : String(e),
          }));
        }
      }
      q.running = false;
      setState((s) => ({ ...s, busy: false }));
    })();
  }, [snapshot, api, basePath, config]);
  return state;
}

/** Preview tokens from the API, kept until shortly before they expire. */
function previewTokens(api: ApiClient) {
  let held: { token: string | null; expires: number | null } | null = null;
  return async (fresh = false): Promise<string | null> => {
    const stale =
      !held || (held.expires !== null && held.expires - 60_000 < Date.now());
    if (fresh || stale) held = await api.previewToken();
    return held!.token;
  };
}

/** What the preview route is sent for a snapshot. */
function previewRequest(
  snapshot: PreviewSnapshot,
  config: VestryConfig,
  fileUrl: (path: string) => string,
): PreviewRequest {
  const col = config.collections?.[snapshot.collection];
  const format = col ? collectionFormat(col) : null;
  const uploads = Object.fromEntries(
    Object.entries(snapshot.uploads).map(([path, previewUrl]) => [
      path,
      { previewUrl } as PendingUpload,
    ]),
  );
  const env = bodyEnv({
    body: col && col.body !== false ? (col.body ?? {}) : null,
    filePath: snapshot.filePath,
    config,
    uploads,
    fileUrl,
  });
  return {
    entry: {
      collection: snapshot.collection,
      slug: snapshot.slug,
      path: snapshot.path,
      // Images and files as the content file holds them, which is what the
      // site's pages read.
      data: col
        ? assetsToStored(col.schema, snapshot.data, snapshot.filePath)
        : snapshot.data,
    },
    body:
      format === "md" || format === "mdx"
        ? previewBody(snapshot.body, {
            format,
            resolveImage: env.resolveImage ?? ((src) => src),
          })
        : [],
  };
}

async function drawPreview({
  snapshot,
  config,
  api,
  basePath,
  token,
}: {
  snapshot: PreviewSnapshot;
  config: VestryConfig;
  api: ApiClient;
  basePath: string;
  token: (fresh?: boolean) => Promise<string | null>;
}): Promise<string> {
  const body = JSON.stringify(previewRequest(snapshot, config, api.fileUrl));
  const post = async (fresh: boolean) => {
    const bearer = await token(fresh);
    return fetch(`${basePath.replace(/\/$/, "")}/preview/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body,
      credentials: "same-origin",
    });
  };
  let res = await post(false);
  // The token ran out (or the secret changed): ask for another, once.
  if (res.status === 401) res = await post(true);
  const text = await res.text();
  if (res.ok && res.headers.get("x-vestry-preview")) return text;
  if (res.ok)
    throw new Error(
      "the preview route didn't answer. A component it imports may fail to load: see the server's log, and give that component preview: false",
    );
  const plain = res.headers.get("content-type")?.startsWith("text/plain");
  throw new Error(
    plain && text
      ? text
      : `the site couldn't draw this page (error ${res.status})`,
  );
}

/**
 * The page in an iframe, drawn into a second frame behind it and swapped in
 * when it has loaded, so a redraw doesn't flash or lose the scroll position.
 * Links open the live site in a new tab, rather than leaving the preview.
 */
function PreviewFrame({
  page,
  width,
}: {
  page: PreviewedPage;
  width: number | null;
}) {
  const first = useRef<HTMLIFrameElement>(null);
  const second = useRef<HTMLIFrameElement>(null);
  const [front, setFront] = useState(0);
  // The frame in view, the page in it, and the page loading behind it.
  const view = useRef({ front: 0, shown: null as PreviewedPage | null });
  const loading = useRef<PreviewedPage | null>(null);

  useEffect(() => {
    const frame = (view.current.front === 0 ? second : first).current;
    if (!frame) return;
    loading.current = page;
    frame.srcdoc = withBase(page.html, page.path);
  }, [page]);

  const onLoad = (index: number) => {
    const frames = [first.current, second.current];
    const frame = frames[index];
    const loaded = loading.current;
    if (index === view.current.front || !frame?.contentWindow || !loaded)
      return;
    keepLinksOut(frame.contentWindow.document);
    const previous = frames[view.current.front]?.contentWindow;
    if (previous && view.current.shown?.entry === loaded.entry)
      frame.contentWindow.scrollTo(previous.scrollX, previous.scrollY);
    view.current = { front: index, shown: loaded };
    loading.current = null;
    setFront(index);
  };

  return (
    <div
      className="v-preview__viewport"
      style={width ? { width, maxWidth: "100%" } : undefined}
    >
      {[first, second].map((ref, index) => (
        <iframe
          key={index}
          ref={ref}
          title={index === front ? "Page preview" : "Next page preview"}
          className="v-preview__frame"
          aria-hidden={index === front ? undefined : true}
          data-front={index === front ? "" : undefined}
          onLoad={() => onLoad(index)}
        />
      ))}
    </div>
  );
}

/** The page with a `<base>`, so its relative links resolve as they would on the site. */
function withBase(html: string, path: string | null): string {
  const href = new URL(path ?? "/", window.location.origin).href;
  const base = `<base href="${href.replace(/"/g, "&quot;")}">`;
  // After `<head>`, or else after the doctype: anything before that would
  // put the page in quirks mode.
  const after =
    /<head(\s[^>]*)?>/i.exec(html) ?? /^\s*<!doctype[^>]*>/i.exec(html);
  if (!after) return base + html;
  const at = after.index + after[0].length;
  return html.slice(0, at) + base + html.slice(at);
}

/** Same-page links scroll the preview; any other opens in a new tab; forms don't send. */
function keepLinksOut(doc: Document) {
  doc.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    const link = (event.target as Element | null)?.closest?.("a[href]");
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      doc.getElementById(fragmentId(href))?.scrollIntoView();
      return;
    }
    const url = linkUrl(href, doc.baseURI);
    if (url) window.open(url, "_blank", "noopener");
  });
  doc.addEventListener("submit", (event) => event.preventDefault());
}

/** A link's address, resolved from its attribute (an SVG link's `href` is no string); null if it isn't one. */
function linkUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/** The id a `#fragment` link names, as written if it isn't valid percent-encoding. */
function fragmentId(href: string): string {
  const id = href.slice(1);
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

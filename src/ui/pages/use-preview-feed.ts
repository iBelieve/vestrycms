import { useCallback, useEffect, useRef } from "react";
import { useVestry } from "../context.js";
import {
  isPreviewMessage,
  PREVIEW_WINDOW,
  previewChannel,
  type PreviewMessage,
  type PreviewSnapshot,
} from "../lib/preview-channel.js";

/** How long after the last change the preview window is sent the entry. */
const PREVIEW_SEND_DELAY = 250;

/**
 * Keeps the preview window, while one is open, showing this editor's entry
 * as it stands (see `preview-channel.ts`). Returns what the Preview button
 * does: open the window, or bring it back; null when the collection has no
 * preview (`snapshot` is null).
 */
export function usePreviewFeed(
  snapshot: PreviewSnapshot | null,
): (() => void) | null {
  const { basePath } = useVestry();
  const channel = useRef<BroadcastChannel | null>(null);
  const windowOpen = useRef(false);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const enabled = snapshot !== null;

  const send = useCallback(() => {
    const current = latest.current;
    if (!current) return;
    const message: PreviewMessage = { type: "entry", snapshot: current };
    channel.current?.postMessage(message);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const opened = previewChannel(basePath);
    if (!opened) return;
    channel.current = opened;
    opened.onmessage = ({ data }: MessageEvent) => {
      if (!isPreviewMessage(data)) return;
      if (data.type === "bye") windowOpen.current = false;
      if (data.type !== "hello") return;
      windowOpen.current = true;
      // Another tab's editor may answer too: the one in view is the one
      // being worked on.
      if (document.visibilityState === "visible") send();
    };
    opened.postMessage({ type: "who" } satisfies PreviewMessage);
    return () => {
      opened.close();
      channel.current = null;
    };
  }, [basePath, enabled, send]);

  useEffect(() => {
    if (!snapshot || !windowOpen.current) return;
    const timer = setTimeout(send, PREVIEW_SEND_DELAY);
    return () => clearTimeout(timer);
  }, [snapshot, send]);

  const open = useCallback(() => {
    // Opened empty first: naming the address would reload a window that
    // is already open.
    const popup = window.open(
      "",
      PREVIEW_WINDOW,
      "popup,width=1280,height=900",
    );
    if (popup && popup.location.href === "about:blank")
      popup.location.href = `${basePath.replace(/\/$/, "")}/preview`;
    popup?.focus();
    // A window that is already open shows this entry now; a new one asks
    // for it when it has loaded.
    windowOpen.current = true;
    send();
  }, [basePath, send]);

  return enabled ? open : null;
}

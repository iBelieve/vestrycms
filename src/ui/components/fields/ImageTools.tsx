import { Crosshair, Maximize2, RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CropField, FocalPointField } from "../../../config/types.js";
import { useVestry } from "../../context.js";
import { cx } from "../../lib/utils.js";
import type { PendingUpload } from "../AssetPicker.js";
import { Button } from "../ui.js";
import {
  clamp,
  defaultCrop,
  dragCrop,
  formatAspect,
  HANDLES,
  isCropRect,
  isFocalPoint,
  normalizeCrop,
  type CropRect,
  type FocalPoint,
  type Handle,
} from "./crop.js";

/** Resolve the sibling image field's value to a URL the browser can load. */
function useImageSource(
  imagePath: unknown,
  pendingUploads?: Record<string, PendingUpload>,
): string | null {
  const { api } = useVestry();
  if (typeof imagePath !== "string" || !imagePath) return null;
  const pending = pendingUploads?.[imagePath];
  if (pending) return pending.previewUrl;
  return /^https?:\/\//.test(imagePath) ? imagePath : api.fileUrl(imagePath);
}

interface Fitted {
  natural: { width: number; height: number };
  display: { width: number; height: number };
}

/** Load the image, track its natural size, and fit it into the available width. */
function useFittedImage(src: string | null, maxHeight: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    setNatural(null);
    setError(false);
    if (!src) return;
    const img = new Image();
    img.onload = () =>
      setNatural({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => setError(true);
    img.src = src;
  }, [src]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [src]);

  let fitted: Fitted | null = null;
  if (natural && containerWidth > 0) {
    const scale = Math.min(
      containerWidth / natural.width,
      maxHeight / natural.height,
      1,
    );
    fitted = {
      natural,
      display: {
        width: Math.round(natural.width * scale),
        height: Math.round(natural.height * scale),
      },
    };
  }
  return { containerRef, fitted, error };
}

/** Dragging a handle must not start a text selection elsewhere on the page. */
const preventSelection = (e: React.MouseEvent) => e.preventDefault();

export function CropInput({
  field,
  value,
  onChange,
  siblings,
  pendingUploads,
}: {
  field: CropField;
  value: unknown;
  onChange: (v: CropRect | undefined) => void;
  siblings?: Record<string, unknown>;
  pendingUploads?: Record<string, PendingUpload>;
}) {
  const src = useImageSource(siblings?.[field.image], pendingUploads);
  const { containerRef, fitted, error } = useFittedImage(src, 440);
  const minSize = field.minSize ?? 16;
  const aspect = field.aspect;
  const rect = isCropRect(value) ? value : null;
  const drag = useRef<{
    mode: "move" | Handle;
    start: { x: number; y: number };
    origin: CropRect;
  } | null>(null);

  // Once the image is known, seed a default crop or clamp an out-of-range one.
  useEffect(() => {
    if (!fitted) return;
    if (!rect) {
      onChange(defaultCrop(fitted.natural, aspect));
      return;
    }
    const fixed = normalizeCrop(rect, fitted.natural, aspect, minSize);
    if (
      fixed.x !== rect.x ||
      fixed.y !== rect.y ||
      fixed.width !== rect.width ||
      fixed.height !== rect.height
    )
      onChange(fixed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitted?.natural.width, fitted?.natural.height]);

  const scale = fitted ? fitted.display.width / fitted.natural.width : 1;

  const onPointerDown = (mode: "move" | Handle) => (e: React.PointerEvent) => {
    if (!rect || !fitted) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      mode,
      start: { x: e.clientX, y: e.clientY },
      origin: rect,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !fitted) return;
    const dx = (e.clientX - d.start.x) / scale;
    const dy = (e.clientY - d.start.y) / scale;
    const next = dragCrop(d.mode, d.origin, dx, dy, aspect, minSize);
    onChange(normalizeCrop(next, fitted.natural, aspect, minSize));
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rect || !fitted) return;
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    onChange(
      normalizeCrop(
        { ...rect, x: rect.x + m[0], y: rect.y + m[1] },
        fitted.natural,
        aspect,
        minSize,
      ),
    );
  };

  if (!src)
    return (
      <div className="v-image-tool__empty">
        Choose an image in “{field.image}” first.
      </div>
    );
  if (error)
    return (
      <div className="v-image-tool__empty">The image could not be loaded.</div>
    );

  const disp =
    rect && fitted
      ? {
          left: rect.x * scale,
          top: rect.y * scale,
          width: rect.width * scale,
          height: rect.height * scale,
        }
      : null;

  return (
    <div className="v-image-tool">
      <div ref={containerRef} className="v-image-tool__stage">
        {fitted && (
          <div
            className="v-crop"
            style={{
              width: fitted.display.width,
              height: fitted.display.height,
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img
              src={src}
              alt=""
              draggable={false}
              style={{
                width: fitted.display.width,
                height: fitted.display.height,
              }}
            />
            {disp && (
              <>
                <div
                  className="v-crop__shade"
                  style={{ top: 0, left: 0, right: 0, height: disp.top }}
                />
                <div
                  className="v-crop__shade"
                  style={{
                    top: disp.top + disp.height,
                    left: 0,
                    right: 0,
                    bottom: 0,
                  }}
                />
                <div
                  className="v-crop__shade"
                  style={{
                    top: disp.top,
                    left: 0,
                    width: disp.left,
                    height: disp.height,
                  }}
                />
                <div
                  className="v-crop__shade"
                  style={{
                    top: disp.top,
                    left: disp.left + disp.width,
                    right: 0,
                    height: disp.height,
                  }}
                />
                <div
                  className="v-crop__box"
                  style={{
                    left: disp.left,
                    top: disp.top,
                    width: disp.width,
                    height: disp.height,
                  }}
                  tabIndex={0}
                  role="slider"
                  aria-label="Crop area"
                  onPointerDown={onPointerDown("move")}
                  onMouseDown={preventSelection}
                  onKeyDown={onKeyDown}
                >
                  <div className="v-crop__grid" />
                  {HANDLES.map((h) => (
                    <div
                      key={h}
                      className={cx("v-crop__handle", `v-crop__handle--${h}`)}
                      onPointerDown={onPointerDown(h)}
                      onMouseDown={preventSelection}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {!fitted && <div className="v-image-tool__loading">Loading image…</div>}
      </div>
      <div className="v-image-tool__bar">
        <span className="v-mono v-muted">
          {rect
            ? `${rect.width} × ${rect.height} px at ${rect.x}, ${rect.y}`
            : "—"}
          {fitted &&
            ` · image ${fitted.natural.width} × ${fitted.natural.height}`}
          {aspect && ` · ${formatAspect(aspect)}`}
        </span>
        <span className="v-grow" />
        <Button
          size="xs"
          onClick={() =>
            fitted && onChange(defaultCrop(fitted.natural, aspect))
          }
          disabled={!fitted}
          title="Largest crop, centred"
        >
          <Maximize2 /> Fit
        </Button>
      </div>
    </div>
  );
}

export function FocalPointInput({
  field,
  value,
  onChange,
  siblings,
  pendingUploads,
}: {
  field: FocalPointField;
  value: unknown;
  onChange: (v: FocalPoint | undefined) => void;
  siblings?: Record<string, unknown>;
  pendingUploads?: Record<string, PendingUpload>;
}) {
  const src = useImageSource(siblings?.[field.image], pendingUploads);
  const { containerRef, fitted, error } = useFittedImage(src, 360);
  const point: FocalPoint = isFocalPoint(value) ? value : { x: 50, y: 50 };
  const dragging = useRef(false);

  const setFromEvent = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const x = clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
      const y = clamp(((e.clientY - r.top) / r.height) * 100, 0, 100);
      onChange({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    },
    [onChange],
  );

  if (!src)
    return (
      <div className="v-image-tool__empty">
        Choose an image in “{field.image}” first.
      </div>
    );
  if (error)
    return (
      <div className="v-image-tool__empty">The image could not be loaded.</div>
    );

  const previews = field.previews ?? ["16:9", "1:1", "3:4"];
  const position = `${point.x}% ${point.y}%`;

  return (
    <div className="v-image-tool">
      <div ref={containerRef} className="v-image-tool__stage">
        {fitted ? (
          <div
            className="v-focal"
            style={{
              width: fitted.display.width,
              height: fitted.display.height,
            }}
            onMouseDown={preventSelection}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              setFromEvent(e);
            }}
            onPointerMove={(e) => dragging.current && setFromEvent(e)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          >
            <img
              src={src}
              alt=""
              draggable={false}
              style={{
                width: fitted.display.width,
                height: fitted.display.height,
              }}
            />
            <div
              className="v-focal__line v-focal__line--v"
              style={{ left: `${point.x}%` }}
            />
            <div
              className="v-focal__line v-focal__line--h"
              style={{ top: `${point.y}%` }}
            />
            <div
              className="v-focal__marker"
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
              role="img"
              aria-label={`Focal point at ${point.x}%, ${point.y}%`}
            >
              <Crosshair />
            </div>
          </div>
        ) : (
          <div className="v-image-tool__loading">Loading image…</div>
        )}
      </div>
      <div className="v-image-tool__bar">
        <span className="v-mono v-muted">
          {point.x}% {point.y}%
        </span>
        <div className="v-focal__previews">
          {previews.map((p) => {
            const [w, h] = p.split(":").map(Number);
            return (
              <div
                key={p}
                className="v-focal__preview"
                style={{ aspectRatio: `${w} / ${h}` }}
                title={`${p} preview`}
              >
                <img src={src} alt="" style={{ objectPosition: position }} />
              </div>
            );
          })}
        </div>
        <span className="v-grow" />
        <Button
          size="xs"
          onClick={() => onChange({ x: 50, y: 50 })}
          title="Back to centre"
        >
          <RotateCcw /> Centre
        </Button>
      </div>
    </div>
  );
}

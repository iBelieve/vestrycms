/**
 * The geometry of the crop and focal point inputs: rectangles in the
 * image's own pixels, kept inside the image and at the field's aspect.
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FocalPoint {
  x: number;
  y: number;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface Size {
  width: number;
  height: number;
}

export const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** Largest rectangle of the given aspect that fits the image, centred. */
export function defaultCrop(natural: Size, aspect?: number): CropRect {
  if (!aspect)
    return { x: 0, y: 0, width: natural.width, height: natural.height };
  let width = natural.width;
  let height = Math.round(width / aspect);
  if (height > natural.height) {
    height = natural.height;
    width = Math.round(height * aspect);
  }
  return {
    x: Math.round((natural.width - width) / 2),
    y: Math.round((natural.height - height) / 2),
    width,
    height,
  };
}

/** `rect` rounded, inside the image, at least `minSize` and at the aspect. */
export function normalizeCrop(
  rect: CropRect,
  natural: Size,
  aspect: number | undefined,
  minSize: number,
): CropRect {
  let width = clamp(Math.round(rect.width), minSize, natural.width);
  let height = clamp(Math.round(rect.height), minSize, natural.height);
  if (aspect) {
    height = Math.round(width / aspect);
    if (height > natural.height) {
      height = natural.height;
      width = Math.round(height * aspect);
    }
  }
  const x = clamp(Math.round(rect.x), 0, natural.width - width);
  const y = clamp(Math.round(rect.y), 0, natural.height - height);
  return { x, y, width, height };
}

/** The crop box's resize handles, clockwise from the top left. */
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * The rectangle a drag makes from `origin`, moved by `dx`, `dy` (image
 * pixels): the whole box for "move", else the edges the handle names. With an
 * aspect, the dimension the handle moves most drives the other, and the box
 * stays anchored at the opposite edge.
 */
export function dragCrop(
  mode: "move" | Handle,
  origin: CropRect,
  dx: number,
  dy: number,
  aspect: number | undefined,
  minSize: number,
): CropRect {
  if (mode === "move") return { ...origin, x: origin.x + dx, y: origin.y + dy };
  const edges = resizeEdges(mode, origin, dx, dy);
  if (aspect)
    lockAspect(edges, mode, origin, Math.abs(dy) > Math.abs(dx), aspect);
  return {
    x: edges.x,
    y: edges.y,
    width: Math.max(minSize, edges.width),
    height: Math.max(minSize, edges.height),
  };
}

/** Moves the edges a handle names. */
function resizeEdges(
  mode: Handle,
  o: CropRect,
  dx: number,
  dy: number,
): CropRect {
  const west = mode.includes("w");
  const north = mode.includes("n");
  return {
    x: west ? o.x + dx : o.x,
    y: north ? o.y + dy : o.y,
    width: west ? o.width - dx : mode.includes("e") ? o.width + dx : o.width,
    height: north
      ? o.height - dy
      : mode.includes("s")
        ? o.height + dy
        : o.height,
  };
}

/** Holds `rect` to `aspect`, from the dimension the drag moves most. */
function lockAspect(
  rect: CropRect,
  mode: Handle,
  o: CropRect,
  mostlyVertical: boolean,
  aspect: number,
) {
  const horizontal = mode === "e" || mode === "w";
  const vertical = mode === "n" || mode === "s";
  if (vertical || (!horizontal && mostlyVertical))
    rect.width = rect.height * aspect;
  else rect.height = rect.width / aspect;
  if (mode.includes("w")) rect.x = o.x + o.width - rect.width;
  if (mode.includes("n")) rect.y = o.y + o.height - rect.height;
}

export function isCropRect(v: unknown): v is CropRect {
  return (
    typeof v === "object" &&
    v !== null &&
    ["x", "y", "width", "height"].every(
      (k) => typeof (v as Record<string, unknown>)[k] === "number",
    )
  );
}

export function formatAspect(aspect: number): string {
  for (const [w, h] of [
    [1, 1],
    [4, 3],
    [3, 4],
    [3, 2],
    [2, 3],
    [16, 9],
    [9, 16],
    [8, 9],
    [21, 9],
    [1.91, 1],
  ]) {
    if (Math.abs(w / h - aspect) < 0.005) return `${w}:${h}`;
  }
  return `${aspect.toFixed(3)}:1`;
}

export function isFocalPoint(v: unknown): v is FocalPoint {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as FocalPoint).x === "number" &&
    typeof (v as FocalPoint).y === "number"
  );
}

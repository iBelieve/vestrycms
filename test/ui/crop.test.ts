import { describe, expect, it } from "vitest";
import {
  defaultCrop,
  dragCrop,
  formatAspect,
  isCropRect,
  isFocalPoint,
  normalizeCrop,
} from "../../src/ui/components/fields/crop.js";

const image = { width: 400, height: 300 };
const box = { x: 100, y: 100, width: 100, height: 50 };

describe("defaultCrop", () => {
  it("takes the whole image, or the largest box at the aspect, centred", () => {
    expect(defaultCrop(image)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(defaultCrop(image, 2)).toEqual({
      x: 0,
      y: 50,
      width: 400,
      height: 200,
    });
    expect(defaultCrop(image, 1)).toEqual({
      x: 50,
      y: 0,
      width: 300,
      height: 300,
    });
  });
});

describe("normalizeCrop", () => {
  it("keeps the box inside the image and at least the minimum size", () => {
    expect(
      normalizeCrop(
        { x: -5.4, y: 290, width: 8, height: 50 },
        image,
        undefined,
        16,
      ),
    ).toEqual({
      x: 0,
      y: 250,
      width: 16,
      height: 50,
    });
    expect(
      normalizeCrop(
        { x: 0, y: 0, width: 999, height: 999 },
        image,
        undefined,
        16,
      ),
    ).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
  });

  it("holds the aspect, shrinking a box too tall for the image", () => {
    expect(
      normalizeCrop({ x: 0, y: 0, width: 100, height: 10 }, image, 2, 16),
    ).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
    expect(
      normalizeCrop({ x: 0, y: 0, width: 400, height: 10 }, image, 1, 16),
    ).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
  });
});

describe("dragCrop", () => {
  it("moves the whole box", () => {
    expect(dragCrop("move", box, 10, -5, undefined, 16)).toEqual({
      ...box,
      x: 110,
      y: 95,
    });
  });

  it("moves the edges a handle names", () => {
    expect(dragCrop("e", box, 10, 10, undefined, 16)).toEqual({
      ...box,
      width: 110,
    });
    expect(dragCrop("s", box, 10, 10, undefined, 16)).toEqual({
      ...box,
      height: 60,
    });
    expect(dragCrop("nw", box, 10, 10, undefined, 16)).toEqual({
      x: 110,
      y: 110,
      width: 90,
      height: 40,
    });
    expect(dragCrop("w", box, 95, 0, undefined, 16)).toEqual({
      x: 195,
      y: 100,
      width: 16,
      height: 50,
    });
  });

  it("drives the other dimension at an aspect, anchored at the far edge", () => {
    // A side handle drives its own dimension.
    expect(dragCrop("e", box, 20, 0, 2, 16)).toEqual({
      ...box,
      width: 120,
      height: 60,
    });
    expect(dragCrop("n", box, 0, -10, 2, 16)).toEqual({
      x: 100,
      y: 90,
      width: 120,
      height: 60,
    });
    // A corner follows whichever way it moved most.
    expect(dragCrop("se", box, 20, 5, 2, 16)).toEqual({
      ...box,
      width: 120,
      height: 60,
    });
    expect(dragCrop("sw", box, 5, 20, 2, 16)).toEqual({
      x: 60,
      y: 100,
      width: 140,
      height: 70,
    });
  });
});

describe("value checks", () => {
  it("knows a crop and a focal point", () => {
    expect(isCropRect(box)).toBe(true);
    expect(isCropRect({ x: 1, y: 2, width: 3 })).toBe(false);
    expect(isCropRect(null)).toBe(false);
    expect(isFocalPoint({ x: 1, y: 2 })).toBe(true);
    expect(isFocalPoint({ x: 1 })).toBe(false);
    expect(isFocalPoint("x")).toBe(false);
  });

  it("names common aspects", () => {
    expect(formatAspect(16 / 9)).toBe("16:9");
    expect(formatAspect(1.91)).toBe("1.91:1");
    expect(formatAspect(1.5)).toBe("3:2");
    expect(formatAspect(1.234)).toBe("1.234:1");
  });
});

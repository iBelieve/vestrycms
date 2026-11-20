// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIT_HEIGHT_PROPERTY,
  useFitToScrollport,
} from "../../src/ui/lib/fit-to-scrollport.js";

/** jsdom has no ResizeObserver; this one reports a resize when `resize()` runs. */
const resizeCallbacks = new Set<() => void>();
globalThis.ResizeObserver = class {
  constructor(private readonly callback: () => void) {}
  observe() {
    resizeCallbacks.add(this.callback);
  }
  unobserve() {}
  disconnect() {
    resizeCallbacks.delete(this.callback);
  }
} as never;
const resize = () => {
  for (const callback of resizeCallbacks) callback();
};

afterEach(cleanup);

function Rail({ sticky }: { sticky: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useFitToScrollport(ref);
  return (
    <aside
      ref={ref}
      data-testid="rail"
      style={sticky ? { position: "sticky", top: "24px" } : undefined}
    />
  );
}

/** Stubs a box's layout: jsdom lays nothing out. */
function stubBox(el: HTMLElement, top: number, clientHeight: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ top } as DOMRect);
  Object.defineProperty(el, "clientTop", { value: 1 });
  Object.defineProperty(el, "clientHeight", { value: clientHeight });
}

/**
 * A scroll container whose visible area runs from 60 to 700 (a 1px border
 * at the top), holding a rail whose top `railTop()` reports. jsdom lays
 * nothing out, so the boxes are stubbed.
 */
function setup(
  sticky: boolean,
  railTop: () => number,
  wrap: (rail: ReactNode) => ReactNode = (rail) => rail,
) {
  const view = render(
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <header />
      {wrap(<Rail sticky={sticky} />)}
    </div>,
  );
  const scroller = view.getByTestId("scroller");
  const rail = view.getByTestId("rail");
  stubBox(scroller, 59, 640);
  vi.spyOn(rail, "getBoundingClientRect").mockImplementation(
    () => ({ top: railTop() }) as DOMRect,
  );
  return { view, scroller, rail };
}

const fitted = (rail: HTMLElement) =>
  rail.style.getPropertyValue(FIT_HEIGHT_PROPERTY);

describe("useFitToScrollport", () => {
  it("ends a sticky rail above the bottom of the visible area as the page scrolls", async () => {
    let top = 160;
    const { view, scroller, rail } = setup(true, () => top);
    // Stubbed after the first measurement, so measure again on a scroll.
    fireEvent.scroll(scroller);
    await vi.waitFor(() => expect(fitted(rail)).toBe("516px"));
    // Scrolled until the rail sticks 24px below the top.
    top = 84;
    fireEvent.scroll(scroller);
    await vi.waitFor(() => expect(fitted(rail)).toBe("592px"));
    view.unmount();
    expect(fitted(rail)).toBe("");
  });

  it("leaves a rail that isn't sticky alone", async () => {
    const { scroller, rail } = setup(false, () => 900);
    fireEvent.scroll(scroller);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(fitted(rail)).toBe("");
  });

  it("drops the height when a breakpoint unsticks the rail", async () => {
    const { rail } = setup(true, () => 160);
    resize();
    await vi.waitFor(() => expect(fitted(rail)).toBe("516px"));
    rail.style.position = "static";
    resize();
    await vi.waitFor(() => expect(fitted(rail)).toBe(""));
  });

  it("follows the scrolling to another box when a breakpoint moves it", async () => {
    let top = 160;
    const { view, rail } = setup(
      true,
      () => top,
      (child) => <div data-testid="inner">{child}</div>,
    );
    // The inner box starts scrolling (as the panel does above 860px, where
    // the shell stops) and its visible area ends at 600.
    const inner = view.getByTestId("inner");
    inner.style.overflowY = "auto";
    stubBox(inner, 59, 540);
    resize();
    await vi.waitFor(() => expect(fitted(rail)).toBe("416px"));
    top = 84;
    fireEvent.scroll(inner);
    await vi.waitFor(() => expect(fitted(rail)).toBe("492px"));
  });
});

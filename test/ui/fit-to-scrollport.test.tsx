// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIT_HEIGHT_PROPERTY,
  useFitToScrollport,
} from "../../src/ui/lib/fit-to-scrollport.js";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

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

/**
 * A scroll container whose visible area runs from 60 to 700 (a 1px border
 * at the top), holding a rail whose top `railTop()` reports. jsdom lays
 * nothing out, so the boxes are stubbed.
 */
function setup(sticky: boolean, railTop: () => number) {
  const view = render(
    <div data-testid="scroller" style={{ overflowY: "auto" }}>
      <header />
      <Rail sticky={sticky} />
    </div>,
  );
  const scroller = view.getByTestId("scroller");
  const rail = view.getByTestId("rail");
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
    top: 59,
  } as DOMRect);
  Object.defineProperty(scroller, "clientTop", { value: 1 });
  Object.defineProperty(scroller, "clientHeight", { value: 640 });
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
});

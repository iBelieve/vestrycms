import { type RefObject, useLayoutEffect } from "react";

/** The custom property the hook sets; the element's CSS caps its height with it. */
export const FIT_HEIGHT_PROPERTY = "--v-fit-height";

/** The nearest ancestor that scrolls vertically: the box `position: sticky` sticks in. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/**
 * The height that keeps an element from `top` (in viewport coordinates)
 * ending `gap` pixels above the bottom of the scroll container's visible area.
 */
function fitHeight(scroller: HTMLElement, top: number, gap: number) {
  const visibleBottom =
    scroller.getBoundingClientRect().top +
    scroller.clientTop +
    scroller.clientHeight;
  return Math.max(0, Math.floor(visibleBottom - top - gap));
}

/**
 * Keeps a sticky element that scrolls on its own (an editor sidebar) within
 * the visible part of its scroll container. A fixed `max-height` only fits
 * once the element has stuck; before that, whatever sits above it (the page
 * heading) pushes its bottom out of view, so its last fields can't be
 * reached without first scrolling the page. This sets `--v-fit-height` to the
 * space between the element's top and the bottom of the visible area (less
 * the gap its `top` leaves above it) as the page scrolls or resizes. While
 * the element isn't sticky (a CSS breakpoint can turn that off), the
 * property is removed.
 */
export function useFitToScrollport(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el && scrollParent(el);
    if (!el || !scroller) return;
    const update = () => {
      const style = getComputedStyle(el);
      if (style.position !== "sticky") {
        el.style.removeProperty(FIT_HEIGHT_PROPERTY);
        return;
      }
      const gap = parseFloat(style.top) || 0;
      const top = el.getBoundingClientRect().top;
      el.style.setProperty(
        FIT_HEIGHT_PROPERTY,
        `${fitHeight(scroller, top, gap)}px`,
      );
    };
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          update();
        });
    };
    update();
    scroller.addEventListener("scroll", schedule, { passive: true });
    // The scroll container resizes with the window; its children change size
    // when content above the element (an error list, a wrapped heading) does.
    const ro = new ResizeObserver(schedule);
    ro.observe(scroller);
    for (const child of scroller.children) ro.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      ro.disconnect();
      el.style.removeProperty(FIT_HEIGHT_PROPERTY);
    };
  }, [ref]);
}

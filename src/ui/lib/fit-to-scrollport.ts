import { type RefObject, useLayoutEffect } from "react";

/** The custom property the hook sets; the element's CSS caps its height with it. */
export const FIT_HEIGHT_PROPERTY = "--v-fit-height";

/**
 * The nearest ancestor that is a scroll container: the box `position: sticky`
 * sticks in. `hidden` counts (it scrolls, just not for the user); `clip` and
 * `visible` don't.
 */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/auto|scroll|hidden/.test(getComputedStyle(p).overflowY)) return p;
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

/** The value for `--v-fit-height`, or "" while the element isn't sticky. */
function fittedValue(el: HTMLElement, scroller: HTMLElement) {
  const style = getComputedStyle(el);
  if (style.position !== "sticky") return "";
  const gap = parseFloat(style.top) || 0;
  return `${fitHeight(scroller, el.getBoundingClientRect().top, gap)}px`;
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
    const first = el && scrollParent(el);
    if (!el || !first) return;
    let scroller: HTMLElement | null = null;
    let fitted = "";
    let frame = 0;
    let moved = false;
    const update = () => {
      if (moved) {
        moved = false;
        watch(scrollParent(el) ?? scroller);
      }
      // Only on a change: the property is inherited, so setting it restyles
      // the whole sidebar, and once stuck every scroll gives the same value.
      const value = scroller ? fittedValue(el, scroller) : "";
      if (value === fitted) return;
      fitted = value;
      if (value) el.style.setProperty(FIT_HEIGHT_PROPERTY, value);
      else el.style.removeProperty(FIT_HEIGHT_PROPERTY);
    };
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          update();
        });
    };
    // The scroll container resizes with the window; its children change size
    // when content above the element (an error list, a wrapped heading) does.
    // A resize can also cross a breakpoint that moves the scrolling to
    // another box (below 860px the shell scrolls, not the panel), so the
    // container is looked up again after one.
    const ro = new ResizeObserver(() => {
      moved = true;
      schedule();
    });
    const watch = (next: HTMLElement | null) => {
      if (next === scroller) return;
      scroller?.removeEventListener("scroll", schedule);
      ro.disconnect();
      scroller = next;
      if (!next) return;
      next.addEventListener("scroll", schedule, { passive: true });
      ro.observe(next);
      for (const child of next.children) ro.observe(child);
    };
    watch(first);
    update();
    return () => {
      cancelAnimationFrame(frame);
      watch(null);
      el.style.removeProperty(FIT_HEIGHT_PROPERTY);
    };
  }, [ref]);
}

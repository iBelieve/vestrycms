// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "../../src/ui/components/ui.js";

function Trigger() {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast("error", "Something broke")}>
      Go
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("toasts", () => {
  it("go away on their own", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("Go").click();
    });
    expect(screen.getByText("Something broke")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.queryByText("Something broke")).toBeNull();
  });

  it("leave no timer behind when the panel unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText("Go").click();
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

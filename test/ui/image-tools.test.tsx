// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openPanel } from "./harness.js";
import { collection, defineConfig, fields } from "../../src/config/index.js";
import { CropInput } from "../../src/ui/components/fields/ImageTools.js";
import {
  VestryContext,
  type VestryContextValue,
} from "../../src/ui/context.js";

/** An image that "loads" at 400 × 300, or fails for a broken address. */
class FakeImage {
  naturalWidth = 400;
  naturalHeight = 300;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    setTimeout(() =>
      (value.includes("broken") ? this.onerror : this.onload)?.(),
    );
  }
}

// jsdom lays nothing out: give the image stage a width.
beforeAll(() => {
  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return this.classList.contains("v-image-tool__stage") ? 400 : 0;
    },
  });
});
afterAll(() => {
  delete (HTMLDivElement.prototype as { clientWidth?: number }).clientWidth;
});

const config = defineConfig({
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  collections: {
    photos: collection({
      label: "Photos",
      path: "src/content/photos/*.json",
      schema: {
        title: fields.text(),
        image: fields.image({ directory: "public/images" }),
        wide: fields.crop({ image: "image", aspect: 2 }),
        free: fields.crop({ image: "image" }),
        focus: fields.focalPoint({ image: "image", previews: ["1:1"] }),
      },
    }),
    albums: collection({
      label: "Albums",
      path: "src/content/albums/*.json",
      schema: {
        title: fields.text(),
        cover: fields.object({
          image: fields.image({ directory: "public/images" }),
          banner: fields.crop({ image: "image", aspect: 2 }),
          square: fields.crop({ image: "image", aspect: 1 }),
        }),
      },
    }),
  },
});

const open = (data: Record<string, unknown>) => {
  vi.stubGlobal("Image", FakeImage);
  return openPanel(config, {
    url: "/collections/photos/p",
    files: {
      "src/content/photos/p.json": JSON.stringify({ title: "P", ...data }),
    },
  });
};
/** The status line under an image tool. */
const bar = (label: string) =>
  field(label).querySelector(".v-image-tool__bar .v-mono")!.textContent;
const field = (label: string) =>
  screen
    .getByText(label, { selector: "label" })
    .closest(".v-field") as HTMLElement;

describe("the image tools", () => {
  it("wait for an image", async () => {
    await open({});
    await screen.findByDisplayValue("P");
    expect(
      within(field("Wide")).getByText("Choose an image in “image” first."),
    ).toBeTruthy();
    expect(
      within(field("Focus")).getByText("Choose an image in “image” first."),
    ).toBeTruthy();
  });

  it("say when the image does not load", async () => {
    await open({ image: "https://example.org/broken.png" });
    await screen.findByDisplayValue("P");
    await waitFor(() =>
      expect(
        within(field("Wide")).getByText("The image could not be loaded."),
      ).toBeTruthy(),
    );
    expect(
      within(field("Focus")).getByText("The image could not be loaded."),
    ).toBeTruthy();
  });

  it("crop an image by dragging and with the keyboard", async () => {
    const user = userEvent.setup();
    const { root } = await open({
      image: "/images/a.png",
      free: { x: 300, y: 0, width: 50, height: 50 },
    });
    const wide = await waitFor(() => within(field("Wide")).getByRole("slider"));
    // A crop starts as the largest box at its aspect.
    expect(bar("Wide")).toMatch(
      /400 × 200 px at 0, 50 · image 400 × 300 · 2.000:1/,
    );
    expect(bar("Free")).toMatch(/50 × 50 px at 300, 0/);

    wide.focus();
    await user.keyboard("{ArrowUp}{Shift>}{ArrowUp}{/Shift}{ArrowDown}{Enter}");
    expect(bar("Wide")).toMatch(/at 0, 40 ·/);

    const free = within(field("Free")).getByRole("slider");
    fireEvent.pointerDown(free, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(free, { clientX: -100, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(free, { pointerId: 1 });
    expect(bar("Free")).toMatch(/50 × 50 px at 200, 20/);
    // Moving after the drag ends does nothing.
    fireEvent.pointerMove(free, { clientX: 0, clientY: 0, pointerId: 1 });
    expect(bar("Free")).toMatch(/at 200, 20/);

    const corner = free.querySelector(".v-crop__handle--se")!;
    fireEvent.pointerDown(corner, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(corner, { clientX: 30, clientY: 10, pointerId: 1 });
    fireEvent.pointerCancel(corner, { pointerId: 1 });
    expect(bar("Free")).toMatch(/80 × 60 px at 200, 20/);

    await user.click(within(field("Free")).getByTitle("Largest crop, centred"));
    expect(bar("Free")).toMatch(/400 × 300 px at 0, 0/);

    await user.click(screen.getByRole("button", { name: /^Save/ }));
    await screen.findByText("Saved to disk");
    const saved = JSON.parse(
      await readFile(path.join(root, "src/content/photos/p.json"), "utf8"),
    );
    expect(saved.wide).toEqual({ x: 0, y: 40, width: 400, height: 200 });
    expect(saved.free).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it("seed two crops at once and keep both", async () => {
    const user = userEvent.setup();
    const { root } = await open({ image: "/images/a.png" });
    // Both crops seed their default as the image loads, in the same moment.
    await waitFor(() => expect(bar("Wide")).toMatch(/400 × 200 px at 0, 50/));
    expect(bar("Free")).toMatch(/400 × 300 px at 0, 0/);
    await user.click(screen.getByRole("button", { name: /^Save/ }));
    await screen.findByText("Saved to disk");
    const saved = JSON.parse(
      await readFile(path.join(root, "src/content/photos/p.json"), "utf8"),
    );
    expect(saved.wide).toEqual({ x: 0, y: 50, width: 400, height: 200 });
    expect(saved.free).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it("seed two crops at once inside an object", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("Image", FakeImage);
    const { root } = await openPanel(config, {
      url: "/collections/albums/a",
      files: {
        "src/content/albums/a.json": JSON.stringify({
          title: "A",
          cover: { image: "/images/a.png" },
        }),
      },
    });
    await waitFor(() => expect(bar("Banner")).toMatch(/400 × 200 px at 0, 50/));
    expect(bar("Square")).toMatch(/300 × 300 px at 50, 0/);
    await user.click(screen.getByRole("button", { name: /^Save/ }));
    await screen.findByText("Saved to disk");
    const saved = JSON.parse(
      await readFile(path.join(root, "src/content/albums/a.json"), "utf8"),
    );
    expect(saved.cover).toEqual({
      image: "/images/a.png",
      banner: { x: 0, y: 50, width: 400, height: 200 },
      square: { x: 50, y: 0, width: 300, height: 300 },
    });
  });

  it("pull a crop out of range back into the image", async () => {
    await open({
      image: "/images/a.png",
      wide: { x: 0, y: 0, width: 400, height: 200 },
      free: { x: 390, y: 0, width: 50, height: 50 },
    });
    await waitFor(() => expect(bar("Free")).toMatch(/50 × 50 px at 350, 0/));
    expect(bar("Wide")).toMatch(/400 × 200 px at 0, 0/);
  });

  it("set a focal point", async () => {
    const user = userEvent.setup();
    await open({
      image: "/images/a.png",
      wide: { x: 0, y: 0, width: 400, height: 200 },
      free: { x: 0, y: 0, width: 400, height: 300 },
      focus: { x: 10, y: 20 },
    });
    const marker = await waitFor(() =>
      within(field("Focus")).getByRole("img", { name: /Focal point/ }),
    );
    expect(marker.getAttribute("aria-label")).toBe("Focal point at 10%, 20%");
    expect(within(field("Focus")).getByTitle("1:1 preview")).toBeTruthy();
    const stage = field("Focus").querySelector(".v-focal") as HTMLElement;
    stage.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    fireEvent.pointerDown(stage, { clientX: 100, clientY: 75, pointerId: 1 });
    expect(bar("Focus")).toBe("25% 25%");
    fireEvent.pointerMove(stage, { clientX: 500, clientY: 150, pointerId: 1 });
    expect(bar("Focus")).toBe("100% 50%");
    fireEvent.pointerUp(stage, { pointerId: 1 });
    fireEvent.pointerMove(stage, { clientX: 0, clientY: 0, pointerId: 1 });
    expect(bar("Focus")).toBe("100% 50%");
    fireEvent.pointerCancel(stage, { pointerId: 1 });
    await user.click(within(field("Focus")).getByTitle("Back to centre"));
    expect(bar("Focus")).toBe("50% 50%");
  });

  it("size a crop from the image it shows, not one that loads late", () => {
    // Images that load only when told to: a.png at 400 × 300, others 200 × 100.
    const loads = new Map<string, () => void>();
    class SlowImage {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        loads.set(value, () => {
          const big = value.includes("a.png");
          this.naturalWidth = big ? 400 : 200;
          this.naturalHeight = big ? 300 : 100;
          this.onload?.();
        });
      }
    }
    vi.stubGlobal("Image", SlowImage);
    const onChange = vi.fn();
    const crop = (image: string) => (
      <VestryContext.Provider value={{} as VestryContextValue}>
        <CropInput
          field={fields.crop({ image: "image" })}
          value={undefined}
          onChange={onChange}
          siblings={{ image }}
        />
      </VestryContext.Provider>
    );
    const a = "https://example.org/a.png";
    const b = "https://example.org/b.png";
    const view = render(crop(a));
    view.rerender(crop(b));
    expect(screen.getByText("Loading image…")).toBeTruthy();
    // The new image loads first, then the one it replaced.
    act(() => loads.get(b)!());
    act(() => loads.get(a)!());
    expect(
      document.querySelector(".v-image-tool__bar .v-mono")!.textContent,
    ).toMatch(/image 200 × 100/);
    expect(onChange).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });
});

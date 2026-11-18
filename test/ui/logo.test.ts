import { afterEach, describe, expect, it, vi } from "vitest";

const api = { fileUrl: (path: string) => `/admin/api/file?path=${path}` };

/** `logoSrc` with `virtual:vestry/logo` exporting `bundled`. */
async function logoSrcWith(bundled: string | null) {
  vi.resetModules();
  vi.doMock("virtual:vestry/logo", () => ({ default: bundled }));
  return (await import("../../src/ui/lib/logo.js")).logoSrc;
}

afterEach(() => vi.doUnmock("virtual:vestry/logo"));

describe("logoSrc", () => {
  it("prefers the logo bundled at build time", async () => {
    const logoSrc = await logoSrcWith("/_astro/logo.abc123.svg");
    expect(logoSrc("src/assets/logo.svg", api)).toBe("/_astro/logo.abc123.svg");
  });

  it("loads the file through the API when none was bundled", async () => {
    const logoSrc = await logoSrcWith(null);
    expect(logoSrc("src/assets/logo.svg", api)).toBe(
      "/admin/api/file?path=src/assets/logo.svg",
    );
  });

  it("uses an absolute URL as given, and nothing without a logo", async () => {
    const logoSrc = await logoSrcWith("/_astro/logo.abc123.svg");
    expect(logoSrc("https://example.org/logo.svg", api)).toBe(
      "https://example.org/logo.svg",
    );
    expect(logoSrc(undefined, api)).toBe(null);
  });
});

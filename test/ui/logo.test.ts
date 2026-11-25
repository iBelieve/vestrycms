import { afterEach, describe, expect, it, vi } from "vitest";
import { logoFiles, logoVariants } from "../../src/config/logo.js";

const api = { fileUrl: (path: string) => `/admin/api/file?path=${path}` };

/** `logoUrls` with `virtual:vestry/logo` exporting `bundled`. */
async function logoUrlsWith(bundled: {
  onDark?: string | null;
  onLight?: string | null;
}) {
  vi.resetModules();
  vi.doMock("virtual:vestry/logo", () => ({
    onDark: bundled.onDark ?? null,
    onLight: bundled.onLight ?? null,
  }));
  return (await import("../../src/ui/lib/logo.js")).logoUrls;
}

afterEach(() => vi.doUnmock("virtual:vestry/logo"));

describe("logoVariants and logoFiles", () => {
  it("reads a plain path as the logo for dark surfaces", () => {
    expect(logoVariants("src/assets/logo.svg")).toEqual({
      onDark: "src/assets/logo.svg",
    });
    expect(logoVariants(undefined)).toEqual({});
  });

  it("lists the logos that are repository files, not URLs", () => {
    expect(
      logoFiles({
        onDark: "https://example.org/logo.svg",
        onLight: "src/assets/logo-light.svg",
      }),
    ).toEqual(["src/assets/logo-light.svg"]);
    expect(logoFiles("src/assets/logo.svg")).toEqual(["src/assets/logo.svg"]);
    expect(logoFiles("HTTPS://example.org/logo.svg")).toEqual([]);
    expect(logoFiles(undefined)).toEqual([]);
  });
});

describe("logoUrls", () => {
  it("prefers the logos bundled at build time", async () => {
    const logoUrls = await logoUrlsWith({
      onDark: "/_astro/logo.abc123.svg",
      onLight: "/_astro/logo-light.def456.svg",
    });
    expect(
      logoUrls(
        { onDark: "src/assets/logo.svg", onLight: "src/assets/logo-light.svg" },
        api,
      ),
    ).toEqual({
      onDark: "/_astro/logo.abc123.svg",
      onLight: "/_astro/logo-light.def456.svg",
    });
  });

  it("loads a logo through the API when it wasn't bundled", async () => {
    const logoUrls = await logoUrlsWith({ onDark: "/_astro/logo.abc123.svg" });
    expect(
      logoUrls(
        { onDark: "src/assets/logo.svg", onLight: "src/assets/logo-light.svg" },
        api,
      ),
    ).toEqual({
      onDark: "/_astro/logo.abc123.svg",
      onLight: "/admin/api/file?path=src/assets/logo-light.svg",
    });
  });

  it("uses an absolute URL as given, and null for a logo not configured", async () => {
    const logoUrls = await logoUrlsWith({ onDark: "/_astro/logo.abc123.svg" });
    expect(logoUrls("https://example.org/logo.svg", api)).toEqual({
      onDark: "https://example.org/logo.svg",
      onLight: null,
    });
    expect(logoUrls({ onLight: "src/assets/logo-light.svg" }, api)).toEqual({
      onDark: null,
      onLight: "/admin/api/file?path=src/assets/logo-light.svg",
    });
    expect(logoUrls(undefined, api)).toEqual({ onDark: null, onLight: null });
  });
});

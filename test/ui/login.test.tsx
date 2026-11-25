// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openPanel, signIn } from "./harness.js";
import { defineConfig } from "../../src/config/index.js";
import type { VestryConfig } from "../../src/config/types.js";

const base = defineConfig({
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
});
const logos = {
  "src/assets/logos/logo.svg": "<svg>dark</svg>",
  "src/assets/logos/logo-light.svg": "<svg>light</svg>",
};
const fileUrl = (path: string) =>
  `/admin/api/file?path=${encodeURIComponent(path)}`;

/** Opens the sign-in page, signed out, for a config with `extra`. */
async function signInPage(extra: Partial<VestryConfig>) {
  await openPanel(
    { ...base, ...extra },
    { files: logos, api: { auth: signIn().options } },
  );
  await screen.findByRole("button", { name: /Email me a code/ });
}

describe("the sign-in page", () => {
  it("shows the light-surface logo, and the dark one in dark mode, as its heading", async () => {
    await signInPage({
      logo: {
        onDark: "src/assets/logos/logo.svg",
        onLight: "src/assets/logos/logo-light.svg",
      },
    });
    const heading = screen.getByRole("heading", { level: 1 });
    const img = screen.getByRole("img", { name: "Test Site" });
    expect(heading.contains(img)).toBe(true);
    // The name is the logo's alt text, not shown beside it.
    expect(heading.textContent).toBe("");
    expect(img.getAttribute("src")).toBe(
      fileUrl("src/assets/logos/logo-light.svg"),
    );
    const source = img.parentElement!.querySelector("source")!;
    expect(source.getAttribute("media")).toBe("(prefers-color-scheme: dark)");
    expect(source.getAttribute("srcset")).toBe(
      fileUrl("src/assets/logos/logo.svg"),
    );
    expect(img.parentElement!.className).toBe("v-login__logo");
  });

  it("serves both logos before anyone signs in", async () => {
    await signInPage({
      logo: {
        onDark: "src/assets/logos/logo.svg",
        onLight: "src/assets/logos/logo-light.svg",
      },
    });
    for (const [path, body] of Object.entries(logos)) {
      const response = await fetch(fileUrl(path));
      expect([path, response.status]).toEqual([path, 200]);
      expect(await response.text()).toBe(body);
    }
  });

  it("puts a dark-surface logo on a dark plate when there is no light one", async () => {
    await signInPage({ logo: "src/assets/logos/logo.svg" });
    const img = screen.getByRole("img", { name: "Test Site" });
    expect(img.getAttribute("src")).toBe(fileUrl("src/assets/logos/logo.svg"));
    expect(img.parentElement!.classList).toContain("v-login__logo--dark-plate");
    expect(img.parentElement!.querySelector("source")).toBeNull();
  });

  it("puts a light-surface logo on a light plate in dark mode when there is no dark one", async () => {
    await signInPage({ logo: { onLight: "src/assets/logos/logo-light.svg" } });
    const img = screen.getByRole("img", { name: "Test Site" });
    expect(img.getAttribute("src")).toBe(
      fileUrl("src/assets/logos/logo-light.svg"),
    );
    expect(img.parentElement!.classList).toContain(
      "v-login__logo--light-plate",
    );
  });

  it("shows the name under the logo with signIn.showName", async () => {
    await signInPage({
      logo: { onLight: "src/assets/logos/logo-light.svg" },
      signIn: { showName: true },
    });
    expect(
      screen.getByRole("heading", { level: 1, name: "Test Site" }).textContent,
    ).toBe("Test Site");
    // The logo would only repeat the heading.
    expect(screen.queryByRole("img", { name: "Test Site" })).toBeNull();
    expect(document.querySelector(".v-login__logo img")).not.toBeNull();
  });

  it("shows the site's initial and name without a logo", async () => {
    await signInPage({});
    expect(
      screen.getByRole("heading", { level: 1, name: "Test Site" }),
    ).toBeTruthy();
    expect(document.querySelector(".v-login__mark")!.textContent).toBe("T");
  });

  it("links to Vestry CMS", async () => {
    await signInPage({});
    const link = screen.getByRole("link", { name: /Powered by Vestry CMS/ });
    expect(link.getAttribute("href")).toBe("https://vestrycms.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});

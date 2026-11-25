// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openPanel } from "./harness.js";
import { collection, defineConfig, fields } from "../../src/config/index.js";

const config = defineConfig({
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  collections: {
    posts: collection({
      label: "Posts",
      singular: "Post",
      path: "src/content/posts/*.md",
      schema: { title: fields.text() },
    }),
    // Reached only from the dashboard: not in the sidebar.
    notes: collection({
      label: "Notes",
      singular: "Note",
      path: "src/content/notes/*.md",
      schema: { title: fields.text() },
    }),
  },
  navigation: [{ label: "Content", items: ["collections.posts"] }],
});

const files = {
  "src/content/posts/a.md": "---\ntitle: A post\n---\n",
  "src/content/notes/n.md": "---\ntitle: A note\n---\n",
};

describe("the sidebar drawer", () => {
  it("opens from the menu button and starts on the current page's link", async () => {
    await openPanel(config, { url: "/collections/posts", files });
    const button = await screen.findByRole("button", { name: "Open menu" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(button);
    const close = screen.getByRole("button", { name: "Close menu" });
    expect(close.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".v-sidebar")!.classList).toContain(
      "is-open",
    );
    expect(document.documentElement.classList).toContain("v-nav-open");
    expect(document.activeElement?.textContent).toContain("Posts");
  });

  it("closes when a link is chosen", async () => {
    await openPanel(config, { url: "/collections/posts", files });
    await userEvent.click(
      await screen.findByRole("button", { name: "Open menu" }),
    );
    await userEvent.click(screen.getByRole("link", { name: /Dashboard/ }));
    await waitFor(() =>
      expect(document.querySelector(".v-sidebar")!.classList).not.toContain(
        "is-open",
      ),
    );
    expect(document.documentElement.classList).not.toContain("v-nav-open");
  });

  it("closes on Escape, returning focus to the menu button", async () => {
    await openPanel(config, { url: "/collections/posts", files });
    await userEvent.click(
      await screen.findByRole("button", { name: "Open menu" }),
    );
    await userEvent.keyboard("{Escape}");
    const button = screen.getByRole("button", { name: "Open menu" });
    expect(document.activeElement).toBe(button);
    expect(document.querySelector(".v-sidebar-backdrop")).toBeNull();
  });

  it("closes when the page changes from outside it, as from the logo", async () => {
    await openPanel(config, { url: "/collections/posts", files });
    await userEvent.click(
      await screen.findByRole("button", { name: "Open menu" }),
    );
    await userEvent.click(screen.getByRole("link", { name: /Test Site/ }));
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(document.querySelector(".v-sidebar")!.classList).not.toContain(
      "is-open",
    );
    expect(document.documentElement.classList).not.toContain("v-nav-open");
  });

  it("stays shut on going back to the page it was opened on", async () => {
    await openPanel(config, { url: "/collections/posts", files });
    await userEvent.click(
      await screen.findByRole("button", { name: "Open menu" }),
    );
    await userEvent.click(screen.getByRole("link", { name: /Dashboard/ }));
    await screen.findByRole("heading", { name: "Dashboard" });
    window.history.back();
    await screen.findByRole("heading", { name: "Posts" });
    expect(document.querySelector(".v-sidebar")!.classList).not.toContain(
      "is-open",
    );
  });

  it("closes when the current page's link is chosen again", async () => {
    await openPanel(config, { url: "/collections/posts", files });
    await userEvent.click(
      await screen.findByRole("button", { name: "Open menu" }),
    );
    await userEvent.click(document.activeElement!);
    await waitFor(() =>
      expect(document.querySelector(".v-sidebar")!.classList).not.toContain(
        "is-open",
      ),
    );
  });

  it("keeps the page beneath out of reach while open", async () => {
    await openPanel(config, { url: "/collections/posts", files });
    await userEvent.click(
      await screen.findByRole("button", { name: "Open menu" }),
    );
    expect(document.querySelector(".v-main")!.hasAttribute("inert")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(document.querySelector(".v-main")!.hasAttribute("inert")).toBe(
      false,
    );
  });

  it("closes when the backdrop is tapped", async () => {
    await openPanel(config, { url: "/collections/posts", files });
    await userEvent.click(
      await screen.findByRole("button", { name: "Open menu" }),
    );
    await userEvent.click(document.querySelector(".v-sidebar-backdrop")!);
    expect(
      screen
        .getByRole("button", { name: "Open menu" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
});

describe("the back link", () => {
  it("links an entry back to its collection, even one missing from the sidebar", async () => {
    await openPanel(config, { url: "/collections/notes/n", files });
    await screen.findByDisplayValue("A note");
    const back = document.querySelector(".v-topbar__back");
    expect(back?.textContent).toBe("Notes");
    expect(back?.getAttribute("href")).toBe("/admin/collections/notes");
  });

  it("is left out when no breadcrumb is a link", async () => {
    await openPanel(config, { url: "/collections/posts", files });
    await screen.findByRole("heading", { name: "Posts" });
    expect(document.querySelector(".v-topbar__back")).toBeNull();
  });
});

describe("the top bar's logo", () => {
  it("shows the dark-surface logo", async () => {
    await openPanel(
      {
        ...config,
        logo: {
          onDark: "src/assets/logo.svg",
          onLight: "src/assets/logo-light.svg",
        },
      },
      { files },
    );
    const img = await screen.findByRole("img", { name: "Test Site" });
    expect(img.getAttribute("src")).toBe(
      "/admin/api/file?path=src%2Fassets%2Flogo.svg",
    );
    expect(img.classList).not.toContain("v-chrome__logo--plate");
  });

  it("puts a light-surface logo on a plate when there is no dark one", async () => {
    await openPanel(
      { ...config, logo: { onLight: "src/assets/logo-light.svg" } },
      { files },
    );
    const img = await screen.findByRole("img", { name: "Test Site" });
    expect(img.getAttribute("src")).toBe(
      "/admin/api/file?path=src%2Fassets%2Flogo-light.svg",
    );
    expect(img.classList).toContain("v-chrome__logo--plate");
  });
});

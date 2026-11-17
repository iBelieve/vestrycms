// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openPanel } from "./harness.js";
import { collection, defineConfig, fields } from "../../src/config/index.js";

const config = defineConfig({
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  collections: {
    posts: collection({
      label: "Posts",
      path: "src/content/posts/*.md",
      schema: { title: fields.text(), date: fields.date() },
    }),
  },
});

describe("the dashboard", () => {
  it("lists the collections", async () => {
    await openPanel(config, {
      files: { "src/content/posts/a.md": "---\ntitle: A\n---\n" },
    });
    expect(await screen.findAllByText("Posts")).not.toHaveLength(0);
  });
});

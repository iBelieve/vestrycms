// @vitest-environment jsdom
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openPanel } from "./harness.js";
import {
  collection,
  defineConfig,
  fields,
  singleton,
} from "../../src/config/index.js";

const config = defineConfig({
  name: "Test Site",
  siteUrl: "https://example.org",
  repo: { owner: "o", name: "r", branch: "main" },
  collections: {
    posts: collection({
      label: "Posts",
      singular: "post",
      path: "src/content/posts/*.md",
      body: false,
      previewUrl: "/posts/{slug}",
      status: { field: "draft", publishedWhen: false },
      sections: [
        { label: "Summary", fields: ["summary"] },
        { label: "Meta", fields: ["author"], sidebar: true },
      ],
      schema: {
        title: fields.text({ required: true }),
        draft: fields.boolean(),
        summary: fields.textarea(),
        author: fields.reference({ collection: "authors" }),
        tag: fields.text({ sidebar: true }),
        updated: fields.datetime({ autoUpdate: true }),
      },
    }),
    authors: collection({
      label: "Authors",
      path: "src/content/authors/*.md",
      body: false,
      delete: false,
      schema: {
        title: fields.text(),
        mentor: fields.reference({ collection: "authors" }),
      },
    }),
    news: collection({
      label: "News",
      path: "src/content/news/**.md",
      body: false,
      schema: {
        title: fields.text(),
        date: fields.date({ storeIn: "filename" }),
      },
    }),
    links: collection({
      label: "Links",
      path: "src/data/links.yaml",
      schema: { id: fields.text(), title: fields.text() },
    }),
  },
  singletons: {
    site: singleton({
      label: "Site",
      path: "src/data/site.yaml",
      schema: { tagline: fields.text() },
    }),
  },
});

const files = {
  "src/content/posts/hello.md":
    "---\ntitle: Hello\ndraft: true\nauthor: ann\n---\n",
  "src/content/authors/ann.md": "---\ntitle: Ann\n---\n",
  "src/content/authors/bob.md": "---\ntitle: Bob\nmentor: ann\n---\n",
  "src/data/links.yaml": "- id: home\n  title: Home\n",
};

const read = (root: string, file: string) =>
  readFile(path.join(root, file), "utf8");
const saveButton = () => screen.getByRole("button", { name: /^(Save|Create)/ });
const titleInput = () =>
  screen.getByPlaceholderText("Title…") as HTMLInputElement;
const slugInput = () => screen.getByPlaceholderText("auto") as HTMLInputElement;

describe("a new entry", () => {
  it("is created at a slug from its title", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/posts/new",
      files,
    });
    await screen.findByText("New post");
    await user.type(titleInput(), "My First Post");
    expect(slugInput().value).toBe("my-first-post");
    expect(screen.getByText("src/content/posts/my-first-post.md")).toBeTruthy();
    await user.click(saveButton());
    await screen.findByText("Saved to disk");
    expect(await read(root, "src/content/posts/my-first-post.md")).toContain(
      "title: My First Post\n",
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        "/admin/collections/posts/my-first-post",
      ),
    );
  });

  it("is checked before it is saved", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/posts/new", files });
    await screen.findByText("New post");
    await user.type(slugInput(), "x");
    await user.click(saveButton());
    expect(await screen.findByText("Please fix the following:")).toBeTruthy();
    expect(screen.getAllByText("Title is required")).toHaveLength(3);
  });

  it("refuses a slug that is taken", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/posts/new", files });
    await screen.findByText("New post");
    await user.type(titleInput(), "Hello");
    await user.click(saveButton());
    expect(
      await screen.findByText(
        'An entry at "src/content/posts/hello.md" already exists. Change the slug.',
      ),
    ).toBeTruthy();
  });

  it("explains a slug it cannot use", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/posts/new", files });
    await screen.findByText("New post");
    await user.type(slugInput(), "a/b");
    expect(
      screen.getByText(
        "This collection has no folders, so a slug cannot contain a slash.",
      ),
    ).toBeTruthy();
    await user.clear(slugInput());
    await user.type(slugInput(), "a b");
    expect(
      screen.getByText("Use letters, numbers, hyphens, dots and underscores."),
    ).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a date from the date field in front of its slug", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/news/new",
      files,
    });
    await screen.findByText("New entry");
    await user.type(titleInput(), "Big News");
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-11-17" },
    });
    expect(screen.getByTitle("Set by the date field").textContent).toBe(
      "2026-11-17-",
    );
    expect(slugInput().value).toBe("big-news");
    await user.click(saveButton());
    await screen.findByText("Saved to disk");
    expect(
      await read(root, "src/content/news/2026-11-17-big-news.md"),
    ).toContain("title: Big News");
  });
});

describe("an existing entry", () => {
  it("is edited and saved", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/posts/hello",
      files,
    });
    await screen.findByDisplayValue("Hello");
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("src/content/posts/hello.md")).toBeTruthy();
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("Set on save")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /^View$/ }).getAttribute("href"),
    ).toBe("https://example.org/posts/hello");
    // A section of one field named like it shows no second label.
    expect(screen.queryByLabelText("Summary")).toBeNull();
    await user.type(document.querySelector("textarea")!, "Short.");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "Draft" }));
    expect(screen.getAllByText("Published").length).toBeGreaterThan(0);
    await user.click(saveButton());
    await screen.findByText("Saved to disk");
    const text = await read(root, "src/content/posts/hello.md");
    expect(text).toContain("summary: Short.");
    expect(text).toContain("draft: false");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("is saved with the keyboard shortcut", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/posts/hello",
      files,
    });
    await screen.findByDisplayValue("Hello");
    await user.clear(titleInput());
    await user.type(titleInput(), "Hi");
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await screen.findByText("Saved to disk");
    expect(await read(root, "src/content/posts/hello.md")).toContain(
      "title: Hi",
    );
  });

  it("is renamed, with the entries that refer to it", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/authors/ann",
      files,
    });
    await screen.findByDisplayValue("Ann");
    expect(screen.queryByTitle("Delete")).toBeNull();
    fireEvent.change(slugInput(), { target: { value: "anna" } });
    expect(
      screen.getByText("Renames the file to src/content/authors/anna.md"),
    ).toBeTruthy();
    await user.click(saveButton());
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("2 other entries refer to this one");
    expect(dialog.textContent).toContain("Posts: Hello");
    expect(dialog.textContent).toContain("Authors: Bob");
    await user.click(within(dialog).getByText("Rename and update"));
    await screen.findByText("Saved to disk");
    expect(await read(root, "src/content/posts/hello.md")).toContain(
      "author: anna",
    );
    expect(await read(root, "src/content/authors/bob.md")).toContain(
      "mentor: anna",
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe("/admin/collections/authors/anna"),
    );
  });

  it("can drop a rename at the confirmation", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/authors/ann", files });
    await screen.findByDisplayValue("Ann");
    fireEvent.change(slugInput(), { target: { value: "anna" } });
    await user.click(saveButton());
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is renamed without asking when nothing refers to it", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/authors/bob",
      files,
    });
    await screen.findByDisplayValue("Bob");
    fireEvent.change(slugInput(), { target: { value: "robert" } });
    await user.click(saveButton());
    await screen.findByText("Saved to disk");
    expect(await read(root, "src/content/authors/robert.md")).toContain(
      "title: Bob",
    );
  });

  it("is deleted after a confirmation", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/posts/hello",
      files,
    });
    await screen.findByDisplayValue("Hello");
    await user.click(screen.getByTitle("Delete"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Delete “Hello”?");
    await user.click(within(dialog).getByText("Cancel"));
    await user.click(screen.getByTitle("Delete"));
    await user.click(
      within(await screen.findByRole("dialog")).getByText("Delete"),
    );
    await screen.findByText("Entry deleted");
    await expect(read(root, "src/content/posts/hello.md")).rejects.toThrow();
    await waitFor(() =>
      expect(window.location.pathname).toBe("/admin/collections/posts"),
    );
  });

  it("is not saved over a newer version", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/posts/hello",
      files,
    });
    await screen.findByDisplayValue("Hello");
    await writeFile(
      path.join(root, "src/content/posts/hello.md"),
      "---\ntitle: Changed\n---\n",
    );
    await user.type(titleInput(), "!");
    await user.click(saveButton());
    expect(
      await screen.findByText(
        "This entry changed since you opened it. Reload the page to pick up the latest version.",
      ),
    ).toBeTruthy();
  });

  it("reports an error the API gives", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/posts/hello",
      files,
    });
    await screen.findByDisplayValue("Hello");
    await rm(path.join(root, "src/content/posts"), {
      recursive: true,
      force: true,
    });
    await writeFile(path.join(root, "src/content/posts"), "not a folder");
    await user.type(titleInput(), "!");
    await user.click(saveButton());
    await waitFor(() =>
      expect(document.querySelector(".v-toast--error")).not.toBeNull(),
    );
  });

  it("says when it does not exist", async () => {
    await openPanel(config, { url: "/collections/posts/missing", files });
    expect(
      await screen.findByText("No entry called “missing”", undefined, {
        timeout: 3000,
      }),
    ).toBeTruthy();
  });

  it("says when its collection does not exist", async () => {
    await openPanel(config, { url: "/collections/nothing/x", files });
    expect(
      await screen.findByText("No collection called “nothing”"),
    ).toBeTruthy();
  });
});

describe("a list kept in one file", () => {
  it("edits an entry by its id", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/links/home",
      files,
    });
    await screen.findByDisplayValue("Home");
    const [, slug] = screen.getAllByDisplayValue("home") as HTMLInputElement[];
    expect(slug!.readOnly).toBe(true);
    await user.type(titleInput(), " page");
    await user.click(saveButton());
    await screen.findByText("Saved to disk");
    expect(await read(root, "src/data/links.yaml")).toContain(
      "title: Home page",
    );
  });
});

describe("a global", () => {
  it("is edited and saved", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/singletons/site",
      files,
    });
    await user.type(await screen.findByLabelText("Tagline"), "Hi");
    await user.click(saveButton());
    await screen.findByText("Saved to disk");
    expect(await read(root, "src/data/site.yaml")).toBe("tagline: Hi\n");
    await act(async () => {});
  });

  it("says when it does not exist", async () => {
    await openPanel(config, { url: "/singletons/nothing", files });
    expect(
      await screen.findByText("No global called “nothing”", undefined, {
        timeout: 3000,
      }),
    ).toBeTruthy();
  });
});

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
import { describe, expect, it, vi } from "vitest";
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
    pages: collection({
      label: "Pages",
      singular: "page",
      path: "src/pages/**.md",
      body: false,
      reservedSlugs: ["index", "404"],
      schema: { title: fields.text() },
    }),
    rules: collection({
      label: "Rules",
      path: "src/content/rules/*.md",
      body: false,
      fixedEntries: true,
      schema: { title: fields.text() },
    }),
    links: collection({
      label: "Links",
      path: "src/data/links.yaml",
      reservedSlugs: ["contact"],
      schema: {
        id: fields.text(),
        title: fields.text(),
        next: fields.reference({ collection: "links" }),
      },
    }),
    menus: collection({
      label: "Menus",
      path: "src/content/menus/*.md",
      body: false,
      schema: {
        title: fields.text(),
        first: fields.reference({ collection: "links" }),
      },
    }),
    notes: collection({
      label: "Notes",
      path: "src/content/notes/*.md",
      readOnly: true,
      status: { field: "draft", publishedWhen: false },
      schema: {
        title: fields.text(),
        draft: fields.boolean({ sidebar: true }),
        tags: fields.array(fields.text()),
        see: fields.reference({ collection: "notes" }),
      },
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
  "src/data/links.yaml":
    "- id: home\n  title: Home\n- id: about\n  title: About\n  next: home\n",
  "src/content/menus/main.md": "---\ntitle: Main\nfirst: home\n---\n",
  "src/pages/index.md": "---\ntitle: Home\n---\n",
  "src/content/rules/first.md": "---\ntitle: First\n---\n",
  "src/content/notes/one.md":
    "---\ntitle: One\ndraft: false\ntags:\n  - a\nsee: one\n---\nThe *body*.\n",
};

/** Holds every request with `method` until the returned function is called. */
function holdRequests(method: string): () => void {
  const api = globalThis.fetch;
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    if (init?.method === method) await held;
    return api(input, init);
  });
  return release;
}

const read = (root: string, file: string) =>
  readFile(path.join(root, file), "utf8");
const saveButton = () => screen.getByRole("button", { name: /^(Save|Create)/ });
const titleInput = () =>
  screen.getByPlaceholderText<HTMLInputElement>("Title…");
const slugInput = () => screen.getByPlaceholderText<HTMLInputElement>("auto");

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

  it("keeps what is typed while it is created", async () => {
    const { root } = await openPanel(config, {
      url: "/collections/posts/new",
      files,
    });
    await screen.findByText("New post");
    fireEvent.change(titleInput(), { target: { value: "First" } });
    const release = holdRequests("POST");
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect((saveButton() as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.change(titleInput(), { target: { value: "Second" } });
    fireEvent.change(document.querySelector("textarea")!, {
      target: { value: "Typed while saving." },
    });
    release();
    await waitFor(() =>
      expect(window.location.pathname).toBe("/admin/collections/posts/first"),
    );
    // The editor at the new address (an existing entry's, so it can delete)
    // opens with both changes, unsaved.
    await screen.findByTitle("Delete");
    expect(titleInput().value).toBe("Second");
    expect(screen.getByDisplayValue("Typed while saving.")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(await read(root, "src/content/posts/first.md")).toContain(
      "title: First",
    );
  });

  it("opens as saved when nothing changed while it was created", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/posts/new", files });
    await screen.findByText("New post");
    await user.type(titleInput(), "Quiet");
    await user.click(saveButton());
    await screen.findByText("Saved to disk");
    await waitFor(() =>
      expect(window.location.pathname).toBe("/admin/collections/posts/quiet"),
    );
    await screen.findByTitle("Delete");
    expect(titleInput().value).toBe("Quiet");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
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

  it("keeps what is typed while it saves", async () => {
    const { root } = await openPanel(config, {
      url: "/collections/posts/hello",
      files,
    });
    await screen.findByDisplayValue("Hello");
    fireEvent.change(titleInput(), { target: { value: "First" } });
    // Hold the save until the title has changed again.
    const release = holdRequests("PUT");
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect((saveButton() as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.change(titleInput(), { target: { value: "Second" } });
    release();
    await screen.findByText("Saved to disk");
    expect(await read(root, "src/content/posts/hello.md")).toContain(
      "title: First",
    );
    expect(titleInput().value).toBe("Second");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("opens as saved when it is opened again", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/posts/hello", files });
    await screen.findByDisplayValue("Hello");
    await user.type(titleInput(), " again");
    await user.click(saveButton());
    await screen.findByText("Saved to disk");
    await user.click(screen.getAllByRole("link", { name: "Posts" })[0]);
    await user.click(await screen.findByRole("link", { name: /Hello again/ }));
    await screen.findByDisplayValue("Hello again");
  });

  it("is renamed, with the entries that refer to it", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/authors/ann",
      files,
    });
    await screen.findByDisplayValue("Ann");
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

  it("keeps what is typed while it is renamed", async () => {
    const { root } = await openPanel(config, {
      url: "/collections/authors/bob",
      files,
    });
    await screen.findByDisplayValue("Bob");
    fireEvent.change(slugInput(), { target: { value: "robert" } });
    const release = holdRequests("PUT");
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect((saveButton() as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.change(titleInput(), { target: { value: "Robert" } });
    release();
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        "/admin/collections/authors/robert",
      ),
    );
    // The file it now lives in, which the editor there shows.
    await screen.findByText("src/content/authors/robert.md");
    expect(titleInput().value).toBe("Robert");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(await read(root, "src/content/authors/robert.md")).toContain(
      "title: Bob",
    );
  });

  it("keeps its reference to itself while it is renamed", async () => {
    const { root } = await openPanel(config, {
      url: "/collections/authors/cat",
      files: {
        ...files,
        "src/content/authors/cat.md": "---\ntitle: Cat\nmentor: cat\n---\n",
      },
    });
    await screen.findByDisplayValue("Cat");
    fireEvent.change(slugInput(), { target: { value: "kat" } });
    const release = holdRequests("PUT");
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect((saveButton() as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.change(titleInput(), { target: { value: "Kat" } });
    release();
    await screen.findByText("src/content/authors/kat.md");
    expect(titleInput().value).toBe("Kat");
    // Saving what was typed keeps the reference on the entry's new slug.
    fireEvent.click(saveButton());
    await waitFor(async () =>
      expect(await read(root, "src/content/authors/kat.md")).toContain(
        "title: Kat",
      ),
    );
    expect(await read(root, "src/content/authors/kat.md")).toContain(
      "mentor: kat",
    );
  });

  it("keeps a slug typed while it is renamed", async () => {
    await openPanel(config, { url: "/collections/authors/bob", files });
    await screen.findByDisplayValue("Bob");
    fireEvent.change(slugInput(), { target: { value: "robert" } });
    const release = holdRequests("PUT");
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect((saveButton() as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.change(slugInput(), { target: { value: "roberto" } });
    release();
    await screen.findByText("src/content/authors/robert.md");
    expect(slugInput().value).toBe("roberto");
    expect(
      screen.getByText("Renames the file to src/content/authors/roberto.md"),
    ).toBeTruthy();
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
    await expect(read(root, "src/content/posts/hello.md")).rejects.toThrow(
      /ENOENT/,
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe("/admin/collections/posts"),
    );
  });

  it("names the entries that refer to it before it is deleted", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/authors/ann",
      files,
    });
    await screen.findByDisplayValue("Ann");
    await user.click(screen.getByTitle("Delete"));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Delete anyway");
    expect(dialog.textContent).toContain("2 other entries refer to this one");
    expect(dialog.textContent).toContain("Posts: Hello");
    expect(dialog.textContent).toContain("Authors: Bob");
    await user.click(within(dialog).getByText("Delete anyway"));
    await screen.findByText("Entry deleted");
    await expect(read(root, "src/content/authors/ann.md")).rejects.toThrow(
      /ENOENT/,
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

describe("a fixed slug", () => {
  it("can't be renamed or deleted when it is reserved", async () => {
    await openPanel(config, { url: "/collections/pages/index", files });
    await screen.findByDisplayValue("Home");
    expect(screen.queryByPlaceholderText("auto")).toBeNull();
    expect(screen.getByDisplayValue("index").hasAttribute("readonly")).toBe(
      true,
    );
    expect(
      screen.getByText(
        "This entry's slug is reserved, so it can't be renamed.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTitle("Delete")).toBeNull();
  });

  it("can't be taken by a new entry", async () => {
    const user = userEvent.setup();
    await openPanel(config, { url: "/collections/pages/new", files });
    await screen.findByText("New page");
    await user.type(slugInput(), "404");
    expect(screen.getByText('"404" is a reserved slug.')).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    await user.type(slugInput(), "/missing");
    expect(
      screen.getByText('"404/missing" is under the reserved slug "404".'),
    ).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("can't be taken by a new list entry's id", async () => {
    await openPanel(config, { url: "/collections/links/new", files });
    fireEvent.change(await screen.findByLabelText("Id"), {
      target: { value: "contact" },
    });
    expect(screen.getByText('"contact" is a reserved slug.')).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("can't be taken by an id a new list entry derives from its title", async () => {
    await openPanel(config, { url: "/collections/links/new", files });
    await screen.findByLabelText("Id");
    fireEvent.change(titleInput(), { target: { value: "Contact" } });
    expect(screen.getByText('"contact" is a reserved slug.')).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("has no form for a new entry where the collection's entries are fixed", async () => {
    await openPanel(config, { url: "/collections/rules/new", files });
    await screen.findByText("New entries can't be added to Rules");
    expect(screen.queryByRole("button", { name: /^Create/ })).toBeNull();
  });

  it("can't be renamed or deleted where the collection's entries are fixed", async () => {
    await openPanel(config, { url: "/collections/rules/first", files });
    await screen.findByDisplayValue("First");
    expect(screen.queryByPlaceholderText("auto")).toBeNull();
    expect(
      screen.getByText("This collection doesn't allow renaming entries."),
    ).toBeTruthy();
    expect(screen.queryByTitle("Delete")).toBeNull();
  });
});

describe("a read-only collection", () => {
  it("shows an entry with nothing to change and no way to save", async () => {
    const { root } = await openPanel(config, {
      url: "/collections/notes/one",
      files,
    });
    const title = await screen.findByDisplayValue<HTMLInputElement>("One");
    expect(
      screen.getByText(
        "Notes are read-only here: they can be viewed, but not changed.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    expect(screen.queryByTitle("Delete")).toBeNull();
    expect(screen.getByText("This collection is read-only.")).toBeTruthy();
    // Every control sits in a disabled fieldset: the title, the list's
    // items and buttons, and publishing.
    expect(title.matches(":disabled")).toBe(true);
    expect(screen.getByDisplayValue("a").matches(":disabled")).toBe(true);
    for (const button of screen
      .getByRole("group")
      .querySelectorAll("button, input, textarea, select"))
      expect(button.matches(":disabled")).toBe(true);
    // The body is shown as its source, read-only.
    const body =
      await screen.findByDisplayValue<HTMLTextAreaElement>(/The \*body\*\./);
    expect(body.readOnly).toBe(true);
    // The save shortcut does nothing: no request, so no refusal either.
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText(/read-only in the control panel/)).toBeNull();
    expect(await read(root, "src/content/notes/one.md")).toBe(
      files["src/content/notes/one.md"],
    );
  });

  it("has no form for a new entry", async () => {
    await openPanel(config, { url: "/collections/notes/new", files });
    await screen.findByText("New entries can't be added to Notes");
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
    const [, slug] = screen.getAllByDisplayValue<HTMLInputElement>("home");
    expect(slug.readOnly).toBe(true);
    await user.type(titleInput(), " page");
    await user.click(saveButton());
    await screen.findByText("Saved to disk");
    expect(await read(root, "src/data/links.yaml")).toContain(
      "title: Home page",
    );
  });
});

describe("a list entry's id", () => {
  it("is renamed, with the entries that refer to it", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/links/home",
      files,
    });
    await screen.findByDisplayValue("Home");
    fireEvent.change(screen.getByLabelText("Id"), {
      target: { value: "start" },
    });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    await user.click(saveButton());
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("2 other entries refer to this one");
    expect(dialog.textContent).toContain("Links: About");
    expect(dialog.textContent).toContain("Menus: Main");
    await user.click(within(dialog).getByText("Rename and update"));
    await screen.findByText("Saved to disk");
    expect(await read(root, "src/data/links.yaml")).toBe(
      "- id: start\n  title: Home\n- id: about\n  title: About\n  next: start\n",
    );
    expect(await read(root, "src/content/menus/main.md")).toContain(
      "first: start",
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe("/admin/collections/links/start"),
    );
    // Until the rename is saved, the editor says so.
    await waitFor(() =>
      expect(screen.queryByText("Unsaved changes")).toBeNull(),
    );
    // The id field and the slug both show it.
    expect(await screen.findAllByDisplayValue("start")).toHaveLength(2);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });
});

describe("a list entry with an id a URL would change", () => {
  it("opens and saves at its own address", async () => {
    const user = userEvent.setup();
    const { root } = await openPanel(config, {
      url: "/collections/links",
      files: { "src/data/links.yaml": '- id: "a b?c#d"\n  title: Odd\n' },
    });
    await user.click(await screen.findByRole("link", { name: /Odd/ }));
    await screen.findByDisplayValue("Odd");
    expect(screen.getAllByDisplayValue("a b?c#d")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Id"), {
      target: { value: "e f?g" },
    });
    await user.click(saveButton());
    await screen.findByText("Saved to disk");
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        "/admin/collections/links/e%20f%3Fg",
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Unsaved changes")).toBeNull(),
    );
    expect(await screen.findAllByDisplayValue("e f?g")).toHaveLength(2);
    expect(await read(root, "src/data/links.yaml")).toContain("id: e f?g");
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

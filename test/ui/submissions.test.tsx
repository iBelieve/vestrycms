// @vitest-environment jsdom
import { createRequire } from "node:module";
import type { DatabaseSync as Sqlite } from "node:sqlite";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openPanel, signIn } from "./harness.js";
import { defineConfig } from "../../src/config/index.js";
import { submissionStore } from "../../src/core/submissions.js";

// Required rather than imported: Vitest's jsdom environment won't bundle a
// Node built-in that only Node 22.5+ has.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

const config = defineConfig({
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  auth: { admins: ["owner@example.org"] },
  forms: {
    contact: { label: "Contact form", columns: ["name", "email", "subject"] },
    signup: { label: "Sign-ups", icon: "users" },
  },
});

async function signedIn(url: string, database: Sqlite) {
  const user = userEvent.setup();
  const auth = signIn();
  const { requests } = await openPanel(config, {
    url,
    api: { auth: auth.options, submissionsDatabase: database },
  });
  await user.type(
    await screen.findByPlaceholderText("you@example.org"),
    "owner@example.org",
  );
  await user.click(screen.getByRole("button", { name: /Email me a code/ }));
  await user.type(
    await screen.findByPlaceholderText("123456"),
    auth.lastCode(),
  );
  await user.click(screen.getByRole("button", { name: /Sign in/ }));
  return { user, requests };
}

const at = (minute: number) => new Date(Date.UTC(2026, 10, 21, 12, minute));

describe("form submissions", () => {
  it("lists a form's submissions, opens one, marks it read and deletes it", async () => {
    const db = new DatabaseSync(":memory:");
    const store = submissionStore(db);
    await store.save(
      "contact",
      {
        name: "Ann",
        email: "ann@example.org",
        subject: "A question",
        message: "Line one\nLine two",
      },
      at(1),
    );
    await store.save(
      "contact",
      {
        name: "Bob",
        email: "bob@example.org",
        subject: "Thanks",
        message: "Hi",
      },
      at(2),
    );
    const { user } = await signedIn("/forms/contact", db);

    // The sidebar lists both forms, for admins.
    const nav = await screen.findByRole("navigation");
    expect(within(nav).getByText("Contact form")).toBeTruthy();
    expect(within(nav).getByText("Sign-ups")).toBeTruthy();

    // Newest first, in the configured columns, unread.
    const rows = await waitFor(() => {
      const found = document.querySelectorAll("tbody tr");
      expect(found).toHaveLength(2);
      return found;
    });
    expect(rows[0].textContent).toContain("Bob");
    expect(rows[1].textContent).toContain("A question");
    expect(screen.getAllByTitle("Unread")).toHaveLength(2);
    expect(screen.queryByText("Message")).toBeNull();

    // The link opens it once: the row's own click handler leaves it be.
    const depth = window.history.length;
    await user.click(screen.getByRole("link", { name: /Ann/ }));
    expect(await screen.findByText(/Line one\s+Line two/)).toBeTruthy();
    expect(window.history.length).toBe(depth + 1);
    expect(
      screen.getByRole("link", { name: /Reply/ }).getAttribute("href"),
    ).toBe("mailto:ann%40example.org?subject=Re%3A%20A%20question");
    const [ann] = (await store.list("contact")).submissions.filter(
      (s) => s.data.name === "Ann",
    );
    expect(ann.readAt).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Delete/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(await screen.findByText("Submission deleted.")).toBeTruthy();
    await waitFor(() =>
      expect(document.querySelectorAll("tbody tr")).toHaveLength(1),
    );
    expect(screen.getAllByTitle("Unread")).toHaveLength(1);
    expect((await store.list("contact")).submissions).toHaveLength(1);
  });

  it("says when a form has none", async () => {
    const db = new DatabaseSync(":memory:");
    await signedIn("/forms/signup", db);
    expect(await screen.findByText("No submissions yet")).toBeTruthy();
  });

  it("pages older submissions in", async () => {
    const db = new DatabaseSync(":memory:");
    const store = submissionStore(db);
    for (let i = 0; i < 55; i++)
      await store.save(
        "signup",
        { who: `p${i}`, when: "x", where: "y", extra: "z" },
        at(i),
      );
    const { user } = await signedIn("/forms/signup", db);
    await waitFor(() =>
      expect(document.querySelectorAll("tbody tr")).toHaveLength(50),
    );
    // The first three fields are the columns.
    expect(screen.getByText("Who")).toBeTruthy();
    expect(screen.queryByText("Extra")).toBeNull();
    // The page's last one, deleted elsewhere, still continues the list.
    const shown = await store.list("signup");
    await store.remove("signup", shown.submissions.at(-1)!.id);
    await user.click(
      screen.getByRole("button", { name: "Show older submissions" }),
    );
    await waitFor(() =>
      expect(document.querySelectorAll("tbody tr")).toHaveLength(55),
    );
    expect(
      screen.queryByRole("button", { name: "Show older submissions" }),
    ).toBeNull();
  });

  it("says when a submission is gone", async () => {
    await signedIn("/forms/contact/no-such-id", new DatabaseSync(":memory:"));
    expect(await screen.findByText("Submission not found")).toBeTruthy();
  });

  it("has nothing at a form the config doesn't name", async () => {
    await signedIn("/forms/missing", new DatabaseSync(":memory:"));
    expect(await screen.findByText("Form not found")).toBeTruthy();
  });
});

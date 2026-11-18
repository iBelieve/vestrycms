// @vitest-environment jsdom
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { openPanel } from "./harness.js";
import { defineConfig, fields, singleton } from "../../src/config/index.js";
import type { SourceCommit } from "../../src/core/source.js";
import { LocalSource } from "../../src/core/sources/local.js";

const config = defineConfig({
  name: "Test Site",
  repo: { owner: "o", name: "r", branch: "main" },
  singletons: {
    site: singleton({
      label: "Site",
      path: "src/data/site.yaml",
      schema: { tagline: fields.text() },
    }),
  },
});

const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();

function commit(
  sha: string,
  title: string,
  m: number,
  check: { status: "queued" | "in_progress" | "completed"; ok?: boolean },
  coAuthor = "",
): SourceCommit {
  return {
    sha,
    title,
    message: coAuthor ? `${title}\n\nCo-authored-by: ${coAuthor}` : title,
    date: minutesAgo(m),
    url: `https://github.com/o/r/commit/${sha}`,
    author: { name: "vestry[bot]", email: "bot@example.org" },
    checks: [
      {
        name: "Workers Builds: site",
        status: check.status,
        conclusion:
          check.status === "completed"
            ? check.ok
              ? "success"
              : "failure"
            : null,
        startedAt: check.status === "queued" ? null : minutesAgo(m - 0.1),
        completedAt: check.status === "completed" ? minutesAgo(m - 2) : null,
        url: `https://dash.cloudflare.com/builds/${sha}`,
      },
    ],
  };
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});

/** A local project whose source also reports `commits` as its recent history. */
async function sourceWith(commits: { current: SourceCommit[] }) {
  const root = await mkdtemp(path.join(tmpdir(), "vestry-deploys-"));
  roots.push(root);
  await mkdir(path.join(root, "src/data"), { recursive: true });
  await writeFile(path.join(root, "src/data/site.yaml"), "tagline: Hello\n");
  return Object.assign(new LocalSource(root), {
    recentCommits: async () => commits.current,
  });
}

const chip = () => screen.getByTitle("Site builds");

describe("build status", () => {
  it("shows saves on their way, which one is live, and when they arrive", async () => {
    const user = userEvent.setup();
    const commits = {
      current: [
        commit("c3", "Update Site", 0.5, { status: "queued" }),
        commit("c2", "Update Sermon: Advent", 1, { status: "in_progress" }),
        commit("c1", "Create Page: About", 30, {
          status: "completed",
          ok: true,
        }),
      ],
    };
    await openPanel(config, {
      url: "/singletons/site",
      api: { localSource: await sourceWith(commits) },
    });
    expect(await screen.findByText("Publishing 2 changes")).toBeTruthy();

    await user.click(chip());
    const list = document.querySelector(".v-deploys")!;
    expect(
      within(list as HTMLElement).getByText(/2 changes are on the way/),
    ).toBeTruthy();
    const rows = [...list.querySelectorAll(".v-deploys__row")];
    expect(rows.map((r) => r.className.split("is-")[1])).toEqual([
      "queued",
      "building",
      "live",
    ]);
    expect(rows[2].textContent).toContain("On the site now");
    expect(
      within(rows[1] as HTMLElement)
        .getByRole("link", { name: /Advent/ })
        .getAttribute("href"),
    ).toBe("https://dash.cloudflare.com/builds/c2");
    await user.click(chip());

    // The builds finish; the next save asks again and sees them live.
    commits.current = [
      commit("c3", "Update Site", 0.5, { status: "completed", ok: true }),
      ...commits.current.slice(1),
    ];
    await user.type(await screen.findByLabelText("Tagline"), "!");
    await user.click(screen.getByRole("button", { name: /^Save/ }));
    expect(
      await screen.findByText("Your changes are live on the site"),
    ).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    await act(async () => {});
  });

  it("says when the newest build failed", async () => {
    const commits = {
      current: [
        commit("c2", "Update Site", 5, { status: "completed", ok: false }),
        commit("c1", "Create Page: About", 30, {
          status: "completed",
          ok: true,
        }),
      ],
    };
    await openPanel(config, {
      api: { localSource: await sourceWith(commits) },
    });
    expect(await screen.findByText("Build failed")).toBeTruthy();
    await userEvent.setup().click(chip());
    expect(screen.getByText(/The last build failed/)).toBeTruthy();
  });

  it("doesn't call a change live when its build was cancelled", async () => {
    const user = userEvent.setup();
    const cancelled = commit("c2", "Update Site", 5, { status: "completed" });
    cancelled.checks[0].conclusion = "cancelled";
    const commits = {
      current: [
        commit("c2", "Update Site", 0.5, { status: "in_progress" }),
        commit("c1", "Create Page: About", 30, {
          status: "completed",
          ok: true,
        }),
      ],
    };
    await openPanel(config, {
      url: "/singletons/site",
      api: { localSource: await sourceWith(commits) },
    });
    expect(await screen.findByText("Publishing")).toBeTruthy();

    commits.current = [cancelled, ...commits.current.slice(1)];
    await user.type(await screen.findByLabelText("Tagline"), "!");
    await user.click(screen.getByRole("button", { name: /^Save/ }));
    expect(
      await screen.findByText("Your changes aren't live on the site"),
    ).toBeTruthy();
    expect(screen.getByText("Not live")).toBeTruthy();
    await user.click(chip());
    expect(
      screen.getByText(/The newest change isn't on the site/),
    ).toBeTruthy();
  });

  it("stays out of the way without builds", async () => {
    await openPanel(config);
    await screen.findByText("Dashboard", { selector: "h1 *, h1" });
    await act(async () => {});
    expect(screen.queryByTitle("Site builds")).toBeNull();
  });
});

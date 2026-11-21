import { DatabaseSync } from "node:sqlite";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { createApi } from "../src/core/api.js";
import { LocalSource } from "../src/core/sources/local.js";
import {
  saveSubmission,
  submissionStore,
  type SubmissionDatabase,
} from "../src/core/submissions.js";

/**
 * A D1 binding's shape over `node:sqlite`, as the Worker sees one: with
 * `exec` and `batch` too, as a real binding has.
 */
function fakeD1(db: DatabaseSync): SubmissionDatabase {
  return {
    exec: () => {},
    batch: async () => [],
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        run: async () => db.prepare(sql).run(...(values as never[])),
        all: async <T>() => ({
          results: db.prepare(sql).all(...(values as never[])) as T[],
        }),
      }),
    }),
  };
}

const at = (minute: number) => new Date(Date.UTC(2026, 10, 21, 12, minute));

describe.each([
  ["node:sqlite", (db: DatabaseSync) => db],
  ["D1", fakeD1],
])("submissions on %s", (_name, wrap) => {
  it("saves, lists newest first a page at a time, opens and deletes", async () => {
    const db = new DatabaseSync(":memory:");
    const store = submissionStore(wrap(db), "site_");
    const first = await store.save("contact", { name: "Ann" }, at(1));
    const second = await store.save("contact", { name: "Bob" }, at(2));
    const third = await store.save("contact", { name: "Cy" }, at(3));
    await store.save("other", { name: "Elsewhere" }, at(4));

    const page = await store.list("contact", { limit: 2 });
    expect(page.submissions.map((s) => s.data.name)).toEqual(["Cy", "Bob"]);
    expect(page.more).toBe(true);
    const next = await store.list("contact", {
      limit: 2,
      before: page.submissions[1],
    });
    expect(next.submissions.map((s) => s.id)).toEqual([first]);
    expect(next.more).toBe(false);

    expect(await store.get("contact", second)).toEqual({
      id: second,
      form: "contact",
      data: { name: "Bob" },
      createdAt: at(2).toISOString(),
    });
    // Another form's id isn't this form's.
    expect(await store.get("other", second)).toBeNull();

    await store.markRead("contact", second, at(5));
    await store.markRead("contact", second, at(6));
    expect((await store.get("contact", second))?.readAt).toBe(
      at(5).toISOString(),
    );

    await store.remove("contact", third);
    expect(await store.get("contact", third)).toBeNull();
    // The table carries the prefix, beside other sites' tables.
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name),
    ).toContain("site_submission");
  });

  it("keeps submissions saved in the same minute apart when paging", async () => {
    const store = submissionStore(wrap(new DatabaseSync(":memory:")));
    for (let i = 0; i < 5; i++)
      await store.save("contact", { n: `${i}` }, at(1));
    const seen: string[] = [];
    let before;
    for (;;) {
      const page = await store.list("contact", { limit: 2, before });
      seen.push(...page.submissions.map((s) => s.data.n));
      if (!page.more) break;
      before = page.submissions.at(-1);
    }
    expect(seen.sort()).toEqual(["0", "1", "2", "3", "4"]);
  });
});

describe("saveSubmission", () => {
  const config = {
    forms: { contact: { label: "Contact form" } },
    auth: { tablePrefix: "site_" },
  };

  it("saves a configured form's values as strings, in order", async () => {
    const db = new DatabaseSync(":memory:");
    const id = await saveSubmission({
      config,
      database: db,
      form: "contact",
      data: { name: "Ann", email: "ann@example.org", age: 40, skip: undefined },
    });
    const saved = await submissionStore(db, "site_").get("contact", id);
    expect(saved?.data).toEqual({
      name: "Ann",
      email: "ann@example.org",
      age: "40",
    });
    expect(Object.keys(saved!.data)).toEqual(["name", "email", "age"]);
  });

  it("keeps a plain object's values, as JSON", async () => {
    const db = new DatabaseSync(":memory:");
    const id = await saveSubmission({
      config,
      database: db,
      form: "contact",
      data: { address: { city: "Town" }, tags: ["a", "b"] },
    });
    expect(
      (await submissionStore(db, "site_").get("contact", id))?.data,
    ).toEqual({ address: '{"city":"Town"}', tags: "a,b" });
  });

  it("refuses a form the config doesn't have, and a bad prefix", async () => {
    const db = new DatabaseSync(":memory:");
    await expect(
      saveSubmission({ config, database: db, form: "toString", data: {} }),
    ).rejects.toThrow(/no form "toString"/);
    expect(() => submissionStore(db, "Bad-")).toThrow(/tablePrefix/);
  });

  it("shows a row written by hand rather than losing it", async () => {
    const db = new DatabaseSync(":memory:");
    const store = submissionStore(db);
    const id = await store.save("contact", { a: "b" });
    db.prepare("UPDATE submission SET data = 'not json' WHERE id = ?").run(id);
    expect((await store.get("contact", id))?.data).toEqual({
      data: "not json",
    });
  });
});

describe("the submissions API", () => {
  // Local mode: the local user is an admin, with no sign-in.
  const api = (options: Partial<Parameters<typeof createApi>[0]>) =>
    createApi({
      config: {
        repo: { owner: "o", name: "r", branch: "main" },
        forms: { contact: { label: "Contact" } },
      },
      index: { builtAt: "", files: {} },
      basePath: "/admin",
      env: () => undefined,
      localSource: new LocalSource(process.cwd()),
      ...options,
    });
  const get = (a: ReturnType<typeof createApi>, path: string) =>
    a.handle(new Request(`http://vestry.test/admin/api${path}`));

  it("pages on with the last one's time and id, which go together", async () => {
    const db = new DatabaseSync(":memory:");
    const store = submissionStore(db);
    const old = await store.save("contact", { n: "old" }, at(1));
    await store.save("contact", { n: "new" }, at(2));
    const a = api({ submissionsDatabase: db });
    // A cursor whose row is gone: at the newer one's time, with an id
    // below every UUID, so only the older one comes after it.
    const res = await get(
      a,
      `/submissions/contact?before=0&at=${encodeURIComponent(at(2).toISOString())}`,
    );
    expect(
      ((await res.json()) as { submissions: { id: string }[] }).submissions,
    ).toEqual([expect.objectContaining({ id: old })]);
    expect((await get(a, "/submissions/contact?before=gone")).status).toBe(400);
  });

  it("says so when the sign-in database isn't a SQL one", async () => {
    const res = await get(
      api({ auth: { database: memoryAdapter({}) } }),
      "/submissions/contact",
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/D1 or node:sqlite/);
  });
});

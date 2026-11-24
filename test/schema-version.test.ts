/**
 * What a fresh isolate asks the database. On a Worker every query is a round
 * trip to D1's primary, so a new isolate should learn the auth tables are up
 * to date from one row, a signed-in request should read its session in one
 * query, and the submissions table should cost nothing until it is missing.
 * Runs on real `node:sqlite` files: each `DatabaseSync` opened on the same
 * file stands for one isolate's binding.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { createVestryAuth } from "../src/core/auth.js";
import { memoryMailer } from "../src/core/mail.js";
import { schemaFingerprint } from "../src/core/schema-version.js";
import { submissionStore } from "../src/core/submissions.js";

const dir = mkdtempSync(join(tmpdir(), "vestry-schema-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let files = 0;
const newFile = () => join(dir, `db-${++files}.sqlite`);

/** A database on `file` that records the SQL it is asked to run. */
function isolate(file: string) {
  const db = new DatabaseSync(file);
  const queries: string[] = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    queries.push(sql);
    return prepare(sql);
  };
  return { db, queries };
}

function auth(db: DatabaseSync, tablePrefix = "site_") {
  return createVestryAuth({
    database: db,
    mailer: memoryMailer(),
    secret: "test-secret-test-secret-test-secret-1234",
    baseURL: "http://vestry.test",
    basePath: "/admin/api/auth",
    siteName: "Test Site",
    adminUrl: "http://vestry.test/admin",
    admins: ["owner@example.org"],
    dev: true,
    tablePrefix,
  });
}

const introspects = (queries: string[]) =>
  queries.some((q) => /sqlite_master|pragma_table_info/i.test(q));

describe("the auth schema's version", () => {
  it("lets a new isolate skip the migrator's check of every table", async () => {
    const file = newFile();
    const first = isolate(file);
    await auth(first.db).ensureMigrated();
    expect(introspects(first.queries)).toBe(true);
    const [row] = first.db
      .prepare(`SELECT name, version FROM "site_vestrySchema"`)
      .all() as { name: string; version: string }[];
    expect(row.name).toBe("auth");
    expect(row.version).toMatch(/^[0-9a-f]{64}$/);

    const second = isolate(file);
    await auth(second.db).ensureMigrated();
    expect(second.queries).toEqual([
      `SELECT version FROM "site_vestrySchema" WHERE name = ?`,
    ]);
  });

  it("checks in full again when the version is missing or differs", async () => {
    const file = newFile();
    await auth(isolate(file).db).ensureMigrated();
    const db = new DatabaseSync(file);
    db.exec(`UPDATE "site_vestrySchema" SET version = 'older'`);

    const after = isolate(file);
    await auth(after.db).ensureMigrated();
    expect(introspects(after.queries)).toBe(true);
    const [{ version }] = db
      .prepare(`SELECT version FROM "site_vestrySchema"`)
      .all() as { version: string }[];
    expect(version).not.toBe("older");

    db.exec(`DELETE FROM "site_vestrySchema"`);
    const cleared = isolate(file);
    await auth(cleared.db).ensureMigrated();
    expect(introspects(cleared.queries)).toBe(true);
  });

  it("is kept per table prefix", async () => {
    const file = newFile();
    await auth(isolate(file).db, "a_").ensureMigrated();
    const b = isolate(file);
    await auth(b.db, "b_").ensureMigrated();
    // Site A's tables being current says nothing about site B's.
    expect(introspects(b.queries)).toBe(true);
    const tables = (
      b.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE name LIKE '%vestrySchema'`,
        )
        .all() as { name: string }[]
    )
      .map((t) => t.name)
      .sort();
    expect(tables).toEqual(["a_vestrySchema", "b_vestrySchema"]);
  });

  it("fingerprints a schema by its contents", async () => {
    expect(await schemaFingerprint({ a: 1 })).toBe(
      await schemaFingerprint({ a: 1 }),
    );
    expect(await schemaFingerprint({ a: 1 })).not.toBe(
      await schemaFingerprint({ a: 2 }),
    );
  });
});

describe("a signed-in request", () => {
  it("reads its session and user in one query", async () => {
    const { db, queries } = isolate(newFile());
    const vestryAuth = auth(db);
    await vestryAuth.ensureMigrated();
    await vestryAuth.ensureConfigAdmins();
    const { internalAdapter } = await vestryAuth.auth.$context;
    const [{ id }] = db.prepare(`SELECT id FROM "site_user"`).all() as {
      id: string;
    }[];
    const { token } = await internalAdapter.createSession(id);

    queries.length = 0;
    const found = await internalAdapter.findSession(token);
    expect(found?.user.email).toBe("owner@example.org");
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/site_session/);
    expect(queries[0]).toMatch(/site_user/);
  });
});

describe("the submissions table", () => {
  it("is created when a query finds it missing, then just used", async () => {
    const file = newFile();
    const first = isolate(file);
    await submissionStore(first.db, "site_").save("contact", { name: "Ann" });
    expect(first.queries.filter((q) => q.startsWith("CREATE"))).toHaveLength(2);

    const second = isolate(file);
    const store = submissionStore(second.db, "site_");
    await store.save("contact", { name: "Bob" });
    const { submissions } = await store.list("contact");
    expect(submissions.map((s) => s.data.name).sort()).toEqual(["Ann", "Bob"]);
    // A new isolate goes straight to work: no CREATE statements.
    expect(second.queries.map((q) => q.split(" ")[0])).toEqual([
      "INSERT",
      "SELECT",
    ]);
  });

  it("is created for a read too", async () => {
    const { db } = isolate(newFile());
    const store = submissionStore(db, "site_");
    expect(await store.list("contact")).toEqual({
      submissions: [],
      more: false,
    });
    expect(await store.get("contact", "nope")).toBeNull();
  });
});

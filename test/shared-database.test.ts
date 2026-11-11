/**
 * Several sites sharing one database through `auth.tablePrefix`: each gets
 * its own tables from the migrator, and a user of one site is a stranger to
 * the others. Runs on a real `node:sqlite` database so the migrator and the
 * prefixed table names are exercised for real.
 */
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createApi } from "../src/core/api.js";
import { AUTH_TABLES } from "../src/core/auth.js";
import { memoryMailer } from "../src/core/mail.js";
import { LocalSource } from "../src/core/sources/local.js";
import type { VestryConfig } from "../src/config/types.js";

const database = new DatabaseSync(":memory:");

function site(admin: string, tablePrefix?: string) {
  const config: VestryConfig = {
    name: "Test Site",
    repo: { owner: "o", name: "r", branch: "main" },
    auth: { admins: [admin], ...(tablePrefix ? { tablePrefix } : {}) },
    collections: {},
  };
  const mailer = memoryMailer();
  const api = createApi({
    config,
    index: { builtAt: "", files: {} },
    basePath: "/admin",
    env: () => undefined,
    localSource: new LocalSource(process.cwd()),
    auth: {
      database,
      mailer,
      secret: "test-secret-test-secret-test-secret-1234",
      required: true,
      // Not dev: keeps rate limiting on, so its prefixed table is used too.
      dev: false,
    },
  });
  const sendCode = (email: string) =>
    api.handle(
      new Request(
        "http://vestry.test/admin/api/auth/email-otp/send-verification-otp",
        {
          method: "POST",
          headers: {
            origin: "http://vestry.test",
            "content-type": "application/json",
            "cf-connecting-ip": "203.0.113.7",
          },
          body: JSON.stringify({ email, type: "sign-in" }),
        },
      ),
    );
  return { api, mailer, sendCode };
}

const tables = () =>
  (
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[]
  )
    .map((t) => t.name)
    .filter((n) => !n.startsWith("sqlite_"))
    .sort();

describe("auth.tablePrefix", () => {
  const a = site("a@example.org", "a_");
  const b = site("b@example.org", "b_");
  const plain = site("plain@example.org");

  it("gives each site its own tables in the shared database", async () => {
    for (const s of [a, b, plain]) await s.sendCode("nobody@example.org");
    const names = tables();
    for (const t of AUTH_TABLES) {
      expect(names).toContain(`a_${t}`);
      expect(names).toContain(`b_${t}`);
      expect(names).toContain(t);
    }
  });

  it("keeps users to their own site", async () => {
    await a.sendCode("a@example.org");
    expect(a.mailer.sent).toHaveLength(1);

    // Site A's admin is unknown to site B and the unprefixed site.
    await b.sendCode("a@example.org");
    await plain.sendCode("a@example.org");
    expect(b.mailer.sent).toHaveLength(0);
    expect(plain.mailer.sent).toHaveLength(0);

    const rows = (t: string) =>
      (
        database.prepare(`SELECT email FROM "${t}"`).all() as {
          email: string;
        }[]
      ).map((r) => r.email);
    expect(rows("a_user")).toEqual(["a@example.org"]);
    expect(rows("b_user")).toEqual([]);
    expect(rows("user")).toEqual([]);
  });

  it("rate-limits each site in its own table", () => {
    const keys = (t: string) =>
      (database.prepare(`SELECT key FROM "${t}"`).all() as { key: string }[])
        .length;
    expect(keys("a_rateLimit")).toBeGreaterThan(0);
    expect(keys("b_rateLimit")).toBeGreaterThan(0);
    expect(keys("rateLimit")).toBeGreaterThan(0);
  });

  it("rejects a prefix that is not a plain identifier", async () => {
    const bad = site("x@example.org", "x-y; DROP");
    const mixed = site("x@example.org", "Site_");
    const res = await bad.api.handle(
      new Request("http://vestry.test/admin/api/config"),
    );
    const body = (await res.json()) as { setupError?: string };
    expect(body.setupError).toMatch(/tablePrefix/);
    const res2 = await mixed.api.handle(
      new Request("http://vestry.test/admin/api/config"),
    );
    expect(((await res2.json()) as { setupError?: string }).setupError).toMatch(
      /lowercase/,
    );
  });
});

/**
 * Which version of a schema a database was last migrated to, so a fresh
 * isolate can tell with one query that there is nothing to migrate, rather
 * than reading the layout of every table in the database. One row per
 * schema, in `<prefix>vestrySchema`.
 *
 * Deleting a row makes the next isolate check that schema in full again
 * (and migrate it if it needs to), which is the way back after changing
 * the tables by hand.
 */
import { isMissingTable, sql, type SqlDatabase } from "./sql.js";

export function schemaVersions(database: SqlDatabase, tablePrefix = "") {
  const table = `${tablePrefix}vestrySchema`;
  const db = sql(database);
  return {
    /** The version last recorded for a schema, or null if none is. */
    async get(name: string): Promise<string | null> {
      try {
        const [row] = await db.all<{ version: string }>(
          `SELECT version FROM "${table}" WHERE name = ?`,
          name,
        );
        return row?.version ?? null;
      } catch (e) {
        if (isMissingTable(e)) return null;
        throw e;
      }
    },

    async set(name: string, version: string): Promise<void> {
      await db.run(
        `CREATE TABLE IF NOT EXISTS "${table}" (name TEXT PRIMARY KEY NOT NULL, version TEXT NOT NULL)`,
      );
      await db.run(
        `INSERT INTO "${table}" (name, version) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET version = excluded.version`,
        name,
        version,
      );
    },
  };
}

/** A short, stable fingerprint of a schema description (SHA-256 of its JSON). */
export async function schemaFingerprint(schema: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(schema));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

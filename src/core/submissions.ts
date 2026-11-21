/**
 * Form submissions the site saves (a contact form, say) and admins read in
 * the control panel. They live in the sign-in database, a D1 binding in
 * production or `node:sqlite` in development and tests, in one table per
 * table prefix, created on first use.
 */
import type { VestryConfig } from "../config/types.js";
import { tablePrefixError } from "./table-prefix.js";

/** The values a submission holds, by field. */
export type SubmissionData = Record<string, string>;

export interface Submission {
  id: string;
  form: string;
  data: SubmissionData;
  /** ISO time it was saved. */
  createdAt: string;
  /** ISO time an admin first opened it, if one has. */
  readAt?: string;
}

/** A D1 binding, by the parts of its shape used here. */
interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
  /** Unused, but what tells D1 apart from `node:sqlite`. */
  batch(statements: unknown[]): Promise<unknown>;
}

/** A `node:sqlite` database, likewise. */
interface SqliteLike {
  prepare(sql: string): {
    run(...values: unknown[]): unknown;
    all(...values: unknown[]): unknown[];
  };
  exec(sql: string): void;
}

/** The database submissions are kept in. */
export type SubmissionDatabase = D1Like | SqliteLike;

interface Sql {
  run(sql: string, ...values: unknown[]): Promise<void>;
  all<T>(sql: string, ...values: unknown[]): Promise<T[]>;
}

// By `batch`, which only D1 has: both have `exec`.
const isD1 = (db: SubmissionDatabase): db is D1Like =>
  typeof (db as D1Like).batch === "function";

function sql(db: SubmissionDatabase): Sql {
  if (isD1(db)) {
    return {
      run: async (query, ...values) => {
        await db
          .prepare(query)
          .bind(...values)
          .run();
      },
      all: async <T>(query: string, ...values: unknown[]) =>
        (
          await db
            .prepare(query)
            .bind(...values)
            .all<T>()
        ).results,
    };
  }
  return {
    run: async (query, ...values) => {
      db.prepare(query).run(...values);
    },
    all: async <T>(query: string, ...values: unknown[]) =>
      db.prepare(query).all(...values) as T[],
  };
}

interface Row {
  id: string;
  form: string;
  data: string;
  createdAt: string;
  readAt: string | null;
}

const created = new WeakMap<object, Set<string>>();

/** The submissions in one database, under one table prefix. */
export function submissionStore(
  database: SubmissionDatabase,
  tablePrefix = "",
) {
  const prefixError = tablePrefixError(tablePrefix);
  if (prefixError) throw new Error(prefixError);
  const table = `${tablePrefix}submission`;
  const db = sql(database);

  async function ready() {
    let tables = created.get(database);
    if (!tables) created.set(database, (tables = new Set()));
    if (tables.has(table)) return;
    await db.run(
      `CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY NOT NULL, form TEXT NOT NULL, data TEXT NOT NULL, createdAt TEXT NOT NULL, readAt TEXT)`,
    );
    await db.run(
      `CREATE INDEX IF NOT EXISTS "${table}_form_createdAt" ON "${table}" (form, createdAt)`,
    );
    tables.add(table);
  }

  return {
    async save(form: string, data: SubmissionData, now = new Date()) {
      await ready();
      const id = crypto.randomUUID();
      await db.run(
        `INSERT INTO "${table}" (id, form, data, createdAt) VALUES (?, ?, ?, ?)`,
        id,
        form,
        JSON.stringify(data),
        now.toISOString(),
      );
      return id;
    },

    /**
     * A form's submissions, newest first, a page at a time: `before` is the
     * last one of the previous page (which may have been deleted since).
     */
    async list(
      form: string,
      {
        limit = 50,
        before,
      }: {
        limit?: number;
        before?: Pick<Submission, "id" | "createdAt">;
      } = {},
    ): Promise<{ submissions: Submission[]; more: boolean }> {
      await ready();
      const cursor = before
        ? ` AND (createdAt < ? OR (createdAt = ? AND id < ?))`
        : "";
      const rows = await db.all<Row>(
        `SELECT * FROM "${table}" WHERE form = ?${cursor} ORDER BY createdAt DESC, id DESC LIMIT ?`,
        form,
        ...(before ? [before.createdAt, before.createdAt, before.id] : []),
        limit + 1,
      );
      return {
        submissions: rows.slice(0, limit).map(toSubmission),
        more: rows.length > limit,
      };
    },

    async get(form: string, id: string): Promise<Submission | null> {
      await ready();
      const [row] = await db.all<Row>(
        `SELECT * FROM "${table}" WHERE form = ? AND id = ?`,
        form,
        id,
      );
      return row ? toSubmission(row) : null;
    },

    /** Marks a submission read, unless it already is. */
    async markRead(form: string, id: string, now = new Date()) {
      await ready();
      await db.run(
        `UPDATE "${table}" SET readAt = ? WHERE form = ? AND id = ? AND readAt IS NULL`,
        now.toISOString(),
        form,
        id,
      );
    },

    async remove(form: string, id: string) {
      await ready();
      await db.run(
        `DELETE FROM "${table}" WHERE form = ? AND id = ?`,
        form,
        id,
      );
    },
  };
}

function toSubmission(row: Row): Submission {
  return {
    id: row.id,
    form: row.form,
    data: parseData(row.data),
    createdAt: row.createdAt,
    ...(row.readAt ? { readAt: row.readAt } : {}),
  };
}

function parseData(text: string): SubmissionData {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value))
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, String(v ?? "")]),
      );
  } catch {
    // A row written by hand; shown as one field rather than lost.
  }
  return { data: text };
}

/**
 * Saves a submission of one of the config's `forms` from the site's own
 * code (an Astro action, say), into the database the control panel reads:
 * pass the D1 binding, `VESTRY_DB` unless the integration names another.
 * Values are kept as strings (plain objects as JSON), in the order given.
 * Returns its id.
 */
export async function saveSubmission({
  config,
  database,
  form,
  data,
}: {
  config: Pick<VestryConfig, "forms" | "auth">;
  database: SubmissionDatabase;
  form: string;
  data: Record<string, unknown>;
}): Promise<string> {
  if (!config.forms || !Object.hasOwn(config.forms, form))
    throw new Error(`[vestry] no form "${form}" in the config's forms`);
  const values = Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, asText(v)]),
  );
  return submissionStore(database, config.auth?.tablePrefix).save(form, values);
}

/** A value as kept: a plain object as JSON rather than "[object Object]". */
function asText(value: unknown): string {
  const proto =
    typeof value === "object" && value !== null
      ? (Object.getPrototypeOf(value) as unknown)
      : undefined;
  return proto === Object.prototype || proto === null
    ? JSON.stringify(value)
    : String(value);
}

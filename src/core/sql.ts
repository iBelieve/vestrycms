/**
 * Plain SQL on the sign-in database, for the tables Vestry keeps itself
 * (form submissions, the auth schema's version): a D1 binding in
 * production or `node:sqlite` in development and tests. Light on purpose,
 * since the site's form handlers load it too (`vestrycms/forms`).
 */

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

/** A database Vestry can run its own SQL on. */
export type SqlDatabase = D1Like | SqliteLike;

export interface Sql {
  run(sql: string, ...values: unknown[]): Promise<void>;
  all<T>(sql: string, ...values: unknown[]): Promise<T[]>;
}

// By `batch`, which only D1 has: both have `exec`.
const isD1 = (db: SqlDatabase): db is D1Like =>
  typeof (db as D1Like).batch === "function";

/**
 * Whether Vestry can run SQL on a database it was given: a D1 binding or a
 * `node:sqlite` database, not another Better Auth adapter.
 */
export function isSqlDatabase(db: unknown): db is SqlDatabase {
  if (!db || typeof db !== "object") return false;
  const candidate = db as Partial<D1Like & SqliteLike>;
  return (
    typeof candidate.prepare === "function" &&
    (typeof candidate.batch === "function" ||
      typeof candidate.exec === "function")
  );
}

export function sql(db: SqlDatabase): Sql {
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

/** Whether an error says a table doesn't exist (D1 and `node:sqlite` alike). */
export function isMissingTable(e: unknown): boolean {
  return /no such table/i.test(e instanceof Error ? e.message : String(e));
}

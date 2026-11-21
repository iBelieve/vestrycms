/**
 * The prefix before the names of Vestry's tables in the shared sign-in
 * database. Kept apart from `auth.ts`, so that `submissions.ts`, which sites
 * import, doesn't bring Better Auth along.
 */

// Lowercase only: SQLite (and so D1) table names ignore case, so `Site_`
// and `site_` would silently name the same tables.
const TABLE_PREFIX = /^[a-z][a-z0-9_]*$/;

/** Why a `tablePrefix` is unusable, or undefined when it is fine. */
export function tablePrefixError(prefix: string | undefined) {
  if (prefix === undefined || prefix === "" || TABLE_PREFIX.test(prefix))
    return undefined;
  return `auth.tablePrefix ${JSON.stringify(prefix)} must be lowercase letters, digits and underscores, starting with a letter.`;
}

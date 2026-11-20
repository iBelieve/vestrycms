/**
 * The dashboard's data in one request: each collection's entry and draft
 * counts and its "Recent …" list. The panel used to fetch every collection's
 * full list for this, one request each, and every request pays the sign-in
 * check and the framework's overhead again (on a cold Worker, 50 ms of CPU
 * or more each). Shared with the panel, so nothing here may need Node.
 */
import type { CollectionConfig } from "../config/types.js";
import type { ContentService, EntrySummary } from "./service.js";

/** How many entries a "Recent …" list shows unless `recent` says otherwise. */
const DEFAULT_RECENT = 5;

export type DashboardCollection =
  { count: number; drafts: number; recent: EntrySummary[] } | { error: string };

export interface Dashboard {
  collections: Record<string, DashboardCollection>;
}

function isDateField(col: CollectionConfig, field: string | undefined) {
  const type = field ? col.schema[field]?.type : undefined;
  return type === "date" || type === "datetime";
}

/** The date field the default `recent` rule keys on: a date `sort`. */
function sortDateField(col: CollectionConfig): string | null {
  const field = col.sort?.field;
  return field && isDateField(col, field) ? field : null;
}

/**
 * Which date field (if any) a collection's recent list should show: the
 * sort field when it is a date, else the first date column of its list.
 */
export function recentDateField(col: CollectionConfig): string | null {
  const column = (col.columns ?? [])
    .map((c) => (typeof c === "string" ? c : c.field))
    .find((field) => isDateField(col, field));
  return sortDateField(col) ?? column ?? null;
}

/** How many entries the collection's "Recent …" list shows (0: none). */
export function recentCount(col: CollectionConfig): number {
  if (col.recent === false) return 0;
  if (typeof col.recent === "number") return col.recent;
  if (col.recent === true) return DEFAULT_RECENT;
  return sortDateField(col) ? DEFAULT_RECENT : 0;
}

/**
 * Every collection's counts and recent entries. A collection that fails to
 * list reports its error and the others still load; when all of them fail
 * (GitHub unreachable, say), the first error is thrown so the panel shows
 * it as it would for any request.
 */
export async function buildDashboard(
  service: ContentService,
): Promise<Dashboard> {
  const { config } = service;
  const keys = Object.keys(config.collections ?? {});
  const results = await Promise.allSettled(
    keys.map((key) => service.listEntries(key)),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length && failed.length === results.length) throw failed[0].reason;
  const collections: Record<string, DashboardCollection> = {};
  keys.forEach((key, i) => {
    const result = results[i];
    if (result.status === "rejected") {
      const reason: unknown = result.reason;
      // Answered in a 200, so the API's error handler never logs it.
      console.error(`[vestry] dashboard: could not list "${key}"`, reason);
      collections[key] = {
        error: reason instanceof Error ? reason.message : String(reason),
      };
      return;
    }
    const entries = result.value;
    collections[key] = {
      count: entries.length,
      drafts: entries.filter((e) => e.status === "draft").length,
      recent: entries.slice(0, recentCount(config.collections![key])),
    };
  });
  return { collections };
}

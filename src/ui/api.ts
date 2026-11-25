import type {
  AnalyticsPeriod,
  AnalyticsStatus,
} from "../core/analytics/types.js";
import type { ClientConfig } from "../core/api.js";
import type { Dashboard } from "../core/dashboard.js";
import type { DeployStatus } from "../core/deploys.js";
import type { PublicUser, Role } from "../core/roles.js";
import type { Submission } from "../core/submissions.js";
import type {
  AssetItem,
  EntryDetail,
  EntryReference,
  EntrySummary,
  SaveEntryInput,
  SavedEntry,
} from "../core/service.js";

export type {
  ClientConfig,
  DeployStatus,
  EntryDetail,
  EntryReference,
  SaveEntryInput,
  PublicUser,
  Role,
  Submission,
};

/** Fired on `window` when the API answers 401, so the app can return to sign-in. */
export const UNAUTHORIZED_EVENT = "vestry:unauthorized";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The parts of a thrown error worth showing: its message and any code or status. */
export function describeError(error: unknown): {
  message: string;
  meta: string[];
} {
  let message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  const meta: string[] = [];
  if (error instanceof ApiError) {
    meta.push(`HTTP ${error.status}`);
    // "internal" and "error" are the API's catch-alls; they say nothing.
    if (error.code && error.code !== "internal" && error.code !== "error")
      meta.push(error.code);
  }
  // Platform errors often lead with a code ("D1_ERROR: …"); show it apart
  // from the sentence that follows.
  const prefix = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+):\s+(?=\S)/.exec(message);
  if (prefix) {
    if (!meta.includes(prefix[1])) meta.push(prefix[1]);
    message = message.slice(prefix[0].length);
  }
  return { message: message || "Unknown error", meta };
}

/** A response's JSON body, or null if it has none (or is not JSON). */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * The error a failed request throws. A 401 for want of sign-in also tells
 * the app, which returns to the sign-in page.
 */
function failure(status: number, data: unknown): ApiError {
  const err = (data as { error?: { message?: string; code?: string } } | null)
    ?.error;
  if (status === 401 && err?.code === "unauthorized") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return new ApiError(
    err?.message ?? `Request failed (${status})`,
    status,
    err?.code ?? "error",
  );
}

export function createClient(basePath: string) {
  const prefix = `${basePath.replace(/\/$/, "")}/api`;

  async function request<T>(
    path: string,
    // Plain headers only: spreading a `Headers` object would drop them.
    init: Omit<RequestInit, "headers"> & {
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const res = await fetch(`${prefix}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      credentials: "same-origin",
    });
    if (res.status === 204) return undefined as T;
    const data = await readJson(res);
    if (!res.ok) throw failure(res.status, data);
    return data as T;
  }

  const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");

  return {
    prefix,
    fileUrl: (path: string, sha?: string) =>
      `${prefix}/file?path=${encodeURIComponent(path)}${sha ? `&v=${sha}` : ""}`,
    config: () => request<ClientConfig>("/config"),
    status: () => request<{ head: string }>("/status"),
    /** A token for the site's live preview route; null without sign-in. */
    previewToken: () =>
      request<{ token: string | null; expires: number | null }>(
        "/preview/token",
        { method: "POST" },
      ),
    /** Build and deploy status of the branch's recent commits. */
    deploys: () => request<DeployStatus>("/deploys"),
    /** Every collection's counts and recent entries, in one request. */
    dashboard: () => request<Dashboard>("/dashboard"),
    /** Visitor numbers from the site's analytics provider. */
    analytics: (period: AnalyticsPeriod) =>
      request<AnalyticsStatus>(`/analytics?period=${period}`),
    listUsers: () => request<{ users: PublicUser[] }>("/users"),
    inviteUser: (input: { email: string; name?: string; role: Role }) =>
      request<{ user: PublicUser; mailError?: string }>("/users", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    updateUser: (id: string, patch: { name?: string; role?: Role }) =>
      request<{ user: PublicUser }>(`/users/${enc(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    removeUser: (id: string) =>
      request<{ ok: true }>(`/users/${enc(id)}`, { method: "DELETE" }),
    resendInvite: (id: string) =>
      request<{ user: PublicUser }>(`/users/${enc(id)}/invite`, {
        method: "POST",
      }),
    /** A form's submissions, newest first; `before`, the last one shown, continues a page. */
    listSubmissions: (
      form: string,
      before?: Pick<Submission, "id" | "createdAt">,
    ) =>
      request<{ submissions: Submission[]; more: boolean }>(
        `/submissions/${enc(form)}${before ? `?${new URLSearchParams({ before: before.id, at: before.createdAt })}` : ""}`,
      ),
    /** One submission, which opening marks read. */
    getSubmission: (form: string, id: string) =>
      request<{ submission: Submission }>(
        `/submissions/${enc(form)}/${enc(id)}`,
      ),
    removeSubmission: (form: string, id: string) =>
      request<{ ok: true }>(`/submissions/${enc(form)}/${enc(id)}`, {
        method: "DELETE",
      }),
    listEntries: (collection: string) =>
      request<{ entries: EntrySummary[]; head: string }>(
        `/collections/${enc(collection)}`,
      ),
    getEntry: (collection: string, slug: string) =>
      request<EntryDetail>(
        `/collections/${enc(collection)}/entries/${enc(slug)}`,
      ),
    createEntry: (collection: string, input: SaveEntryInput) =>
      request<SavedEntry>(`/collections/${enc(collection)}/entries`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    updateEntry: (collection: string, slug: string, input: SaveEntryInput) =>
      request<SavedEntry>(
        `/collections/${enc(collection)}/entries/${enc(slug)}`,
        { method: "PUT", body: JSON.stringify(input) },
      ),
    /** Entries that refer to this one, which a rename updates and a deletion breaks. */
    references: (collection: string, slug: string) =>
      request<{ references: EntryReference[] }>(
        `/collections/${enc(collection)}/references?slug=${enc(slug)}`,
      ),
    deleteEntry: (collection: string, slug: string) =>
      request<{ commit: string }>(
        `/collections/${enc(collection)}/entries/${enc(slug)}`,
        { method: "DELETE" },
      ),
    getSingleton: (key: string) =>
      request<EntryDetail>(`/singletons/${enc(key)}`),
    saveSingleton: (key: string, input: SaveEntryInput) =>
      request<{ sha: string; commit: string }>(`/singletons/${enc(key)}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    /** With `all`, every file below `dir` and no folders (for a search). */
    listAssets: (container: string, dir = "", { all = false } = {}) =>
      request<{ items: AssetItem[]; folders: string[] }>(
        `/assets/${enc(container)}?dir=${encodeURIComponent(dir)}${all ? "&all=1" : ""}`,
      ),
    uploadAssets: (
      container: string,
      dir: string,
      files: { name: string; base64: string }[],
    ) =>
      request<{ commit: string; paths: string[] }>(
        `/assets/${enc(container)}`,
        {
          method: "POST",
          body: JSON.stringify({ dir, files }),
        },
      ),
    deleteAsset: (container: string, path: string) =>
      request<{ commit: string }>(`/assets/${enc(container)}`, {
        method: "DELETE",
        body: JSON.stringify({ path }),
      }),
  };
}

export type ApiClient = ReturnType<typeof createClient>;

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

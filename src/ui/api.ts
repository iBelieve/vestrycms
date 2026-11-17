import type { ClientConfig } from "../core/api.js";
import type { PublicUser, Role } from "../core/roles.js";
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
  EntryDetail,
  EntryReference,
  SaveEntryInput,
  PublicUser,
  Role,
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

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${prefix}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
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
    /** Entries that refer to this one, which a rename would update. */
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
    listAssets: (container: string, dir = "") =>
      request<{ items: AssetItem[]; folders: string[] }>(
        `/assets/${enc(container)}?dir=${encodeURIComponent(dir)}`,
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

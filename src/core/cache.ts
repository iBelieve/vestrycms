/**
 * A tiny cache abstraction so the GitHub source can be snappy. The default is
 * an in-memory LRU with TTLs; hosts can plug in something durable (e.g. a
 * Cloudflare KV namespace) by implementing the same three methods.
 */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

interface MemoryEntry {
  value: unknown;
  expires: number | null;
}

export class MemoryCache implements Cache {
  #map = new Map<string, MemoryEntry>();
  constructor(private maxEntries = 2000) {}

  async get<T>(key: string): Promise<T | undefined> {
    const e = this.#map.get(key);
    if (!e) return undefined;
    if (e.expires !== null && e.expires < Date.now()) {
      this.#map.delete(key);
      return undefined;
    }
    // LRU bump
    this.#map.delete(key);
    this.#map.set(key, e);
    return e.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (this.#map.size >= this.maxEntries) {
      const oldest = this.#map.keys().next().value;
      if (oldest !== undefined) this.#map.delete(oldest);
    }
    this.#map.set(key, {
      value,
      expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.#map.delete(key);
  }
}

/** Adapter for a Cloudflare KV-style namespace (`get`/`put`/`delete` with JSON). */
export function kvCache(namespace: {
  get(key: string, type: "json"): Promise<unknown>;
  put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}): Cache {
  return {
    async get<T>(key: string) {
      return ((await namespace.get(key, "json")) ?? undefined) as T | undefined;
    },
    async set(key, value, ttlSeconds) {
      await namespace.put(
        key,
        JSON.stringify(value),
        ttlSeconds ? { expirationTtl: Math.max(60, ttlSeconds) } : undefined,
      );
    },
    async delete(key) {
      await namespace.delete(key);
    },
  };
}

let shared: MemoryCache | undefined;
export function sharedMemoryCache(): MemoryCache {
  return (shared ??= new MemoryCache());
}

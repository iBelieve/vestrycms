/**
 * A tiny cache abstraction so the GitHub source can be snappy. The default is
 * an in-memory LRU with TTLs, bounded in size; hosts can plug in something durable (e.g. a
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
  /** Approximate bytes, from `approximateSize`. */
  size: number;
}

export interface MemoryCacheOptions {
  maxEntries?: number;
  /**
   * Upper bound on the approximate size of what is held. A Worker isolate
   * has 128 MB in all, and blobs (up to 2 MB each) would otherwise fill it
   * long before `maxEntries` is reached.
   */
  maxBytes?: number;
}

/**
 * An in-memory LRU with TTLs, bounded by entry count and by approximate
 * size. A value larger than the whole budget is not kept.
 */
export class MemoryCache implements Cache {
  #map = new Map<string, MemoryEntry>();
  #bytes = 0;
  readonly maxEntries: number;
  readonly maxBytes: number;

  /** A bare number is `maxEntries` (the original signature). */
  constructor(options: MemoryCacheOptions | number = {}) {
    if (typeof options === "number") options = { maxEntries: options };
    this.maxEntries = options.maxEntries ?? 2000;
    this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  }

  /** Approximate bytes held, for tests and diagnostics. */
  get bytes(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#map.size;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const e = this.#map.get(key);
    if (!e) return undefined;
    if (e.expires !== null && e.expires < Date.now()) {
      this.#remove(key, e);
      return undefined;
    }
    // LRU bump
    this.#map.delete(key);
    this.#map.set(key, e);
    return e.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const existing = this.#map.get(key);
    if (existing) this.#remove(key, existing);
    const size = approximateSize(value);
    if (size > this.maxBytes) return;
    while (
      this.#map.size > 0 &&
      (this.#map.size >= this.maxEntries || this.#bytes + size > this.maxBytes)
    ) {
      const [oldest, entry] = this.#map.entries().next().value!;
      this.#remove(oldest, entry);
    }
    this.#map.set(key, {
      value,
      expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      size,
    });
    this.#bytes += size;
  }

  async delete(key: string): Promise<void> {
    const e = this.#map.get(key);
    if (e) this.#remove(key, e);
  }

  #remove(key: string, entry: MemoryEntry) {
    this.#map.delete(key);
    this.#bytes -= entry.size;
  }
}

/**
 * A rough byte count for a cached value: string lengths plus a small
 * allowance per value, key and element. Cheap enough to run on every set
 * (a 2,000-file tree takes well under a millisecond).
 */
export function approximateSize(value: unknown): number {
  if (typeof value === "string") return 16 + value.length;
  if (value === null || typeof value !== "object") return 8;
  if (ArrayBuffer.isView(value)) return 16 + value.byteLength;
  let size = 16;
  if (Array.isArray(value)) {
    for (const item of value) size += approximateSize(item);
    return size;
  }
  for (const [k, v] of Object.entries(value)) {
    size += 8 + k.length + approximateSize(v);
  }
  return size;
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

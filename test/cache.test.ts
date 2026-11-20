import { describe, expect, it, vi } from "vitest";
import { approximateSize, MemoryCache } from "../src/core/cache.js";

describe("MemoryCache", () => {
  it("returns what was set until it expires", async () => {
    vi.useFakeTimers();
    try {
      const cache = new MemoryCache();
      await cache.set("a", { x: 1 }, 10);
      expect(await cache.get("a")).toEqual({ x: 1 });
      vi.advanceTimersByTime(11_000);
      expect(await cache.get("a")).toBeUndefined();
      expect(cache.bytes).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts the least recently used entry past maxEntries", async () => {
    const cache = new MemoryCache({ maxEntries: 2 });
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.get("a");
    await cache.set("c", 3);
    expect(await cache.get("a")).toBe(1);
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("c")).toBe(3);
  });

  it("still takes a bare maxEntries number", async () => {
    const cache = new MemoryCache(1);
    await cache.set("a", 1);
    await cache.set("b", 2);
    expect(cache.size).toBe(1);
    expect(cache.maxEntries).toBe(1);
  });

  it("does not evict anything when a key is replaced in a full cache", async () => {
    const cache = new MemoryCache({ maxEntries: 2 });
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("b", 3);
    expect(await cache.get("a")).toBe(1);
    expect(await cache.get("b")).toBe(3);
  });

  it("evicts the oldest entries to stay under maxBytes", async () => {
    const blob = "x".repeat(1000);
    const cache = new MemoryCache({ maxBytes: 2500 });
    await cache.set("a", blob);
    await cache.set("b", blob);
    await cache.set("c", blob);
    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBe(blob);
    expect(await cache.get("c")).toBe(blob);
    expect(cache.bytes).toBeLessThanOrEqual(2500);
  });

  it("keeps the byte count in step with replacements and deletes", async () => {
    const cache = new MemoryCache();
    await cache.set("a", "x".repeat(100));
    await cache.set("a", "x".repeat(10));
    expect(cache.bytes).toBe(approximateSize("x".repeat(10)));
    await cache.delete("a");
    expect(cache.bytes).toBe(0);
  });

  it("does not keep a value bigger than the whole budget", async () => {
    const cache = new MemoryCache({ maxBytes: 100 });
    await cache.set("small", "x");
    await cache.set("huge", "x".repeat(1000));
    expect(await cache.get("huge")).toBeUndefined();
    expect(await cache.get("small")).toBe("x");
  });
});

describe("approximateSize", () => {
  it("counts string lengths through arrays and objects", () => {
    const tree = Array.from({ length: 100 }, (_, i) => ({
      path: `src/content/posts/${i}.md`,
      sha: "a".repeat(40),
      size: 10,
    }));
    const size = approximateSize(tree);
    expect(size).toBeGreaterThan(100 * (40 + 20));
    expect(size).toBeLessThan(JSON.stringify(tree).length * 3);
    expect(approximateSize(new Uint8Array(500))).toBeGreaterThanOrEqual(500);
    expect(approximateSize(null)).toBeGreaterThan(0);
  });
});

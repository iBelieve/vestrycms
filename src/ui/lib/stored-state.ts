import { useState } from "react";

/**
 * State kept in localStorage under `key`, so a view or an expanded folder
 * survives a reload. Storage that fails, or holds anything `valid` rejects,
 * falls back to `initial`.
 */
export function useStoredState<T>(
  key: string,
  initial: T,
  valid: (value: unknown) => value is T,
): [T, (update: ((value: T) => T) | T) => void] {
  const read = (): T => {
    try {
      const raw = localStorage.getItem(key);
      const stored: unknown = raw === null ? initial : JSON.parse(raw);
      return valid(stored) ? stored : initial;
    } catch {
      return initial;
    }
  };
  const [state, setState] = useState<{ key: string; value: T }>(() => ({
    key,
    value: read(),
  }));
  // Another collection's list (the page stays mounted): read its key once.
  let value = state.value;
  if (state.key !== key) {
    value = read();
    setState({ key, value });
  }
  const set = (update: ((value: T) => T) | T) =>
    setState((s) => {
      const current = s.key === key ? s.value : read();
      const next =
        typeof update === "function"
          ? (update as (value: T) => T)(current)
          : update;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not remembered, but still applied.
      }
      return { key, value: next };
    });
  return [value, set];
}

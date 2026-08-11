"use client";

import { useEffect, useState } from "react";

const PREFIX = "tracknaija:";

export function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — ignore in demo */
  }
}

/**
 * React hook for a persisted slice of state (synchronized across tabs).
 *
 * Hydration-safe: the initial render always uses `initial` (matching the
 * server/static HTML), then the persisted value is applied after mount —
 * avoiding React hydration mismatches on prerendered dashboard pages.
 */
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  // 1. Load persisted value after mount, replacing the fallback.
  useEffect(() => {
    setValue(load(key, initial));
    setHydrated(true);
  }, [key, initial]);

  // 2. Persist changes — only once hydrated so we never clobber stored data
  //    with the fallback on first paint.
  useEffect(() => {
    if (hydrated) save(key, value);
  }, [key, value, hydrated]);

  // 3. Cross-tab sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFIX + key && e.newValue) {
        try {
          setValue(JSON.parse(e.newValue) as T);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  return [value, setValue] as const;
}

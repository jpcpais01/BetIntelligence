import type { Market } from "./types";

const STORAGE_KEY = "betintelligence.markets.v1";

export const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // trending markets move faster than fixtures

export interface CachedMarkets {
  markets: Market[];
  fetchedAt: string;
}

export function loadCachedMarkets(): CachedMarkets | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.markets) || typeof parsed.fetchedAt !== "string") {
      return null;
    }
    return parsed as CachedMarkets;
  } catch {
    return null;
  }
}

export function saveCachedMarkets(markets: Market[], fetchedAt: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ markets, fetchedAt }));
  } catch {
    // Storage full or unavailable — caching is best effort, never fatal.
  }
}

export function isStale(fetchedAt: string | null): boolean {
  if (!fetchedAt) return true;
  const t = new Date(fetchedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= REFRESH_INTERVAL_MS;
}

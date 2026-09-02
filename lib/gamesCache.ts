import type { Game } from "./types";

const STORAGE_KEY = "betintelligence.games.v1";

export const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export interface CachedGames {
  games: Game[];
  fetchedAt: string;
}

export function loadCachedGames(): CachedGames | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.games) || typeof parsed.fetchedAt !== "string") {
      return null;
    }
    return parsed as CachedGames;
  } catch {
    return null;
  }
}

export function saveCachedGames(games: Game[], fetchedAt: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ games, fetchedAt }));
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

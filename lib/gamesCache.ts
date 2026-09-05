import type { Game } from "./types";
import { hasKickedOff, isOverByClock } from "./matchClock";

const STORAGE_KEY = "betintelligence.games.v1";

export const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

// Merges a fresh fetch with the previously-known list: fresh data always wins for any game it
// still contains, and a match that has kicked off but isn't over yet is kept from the previous
// list even when the fresh fetch no longer has it. Polymarket drops an event from its own
// closed:"false" feed within hours of kickoff, well before the match itself is done, so a plain
// wholesale swap made a live game vanish mid-match.
//
// A game that hasn't started yet and is missing from a fresh fetch is NOT preserved: that's a
// real removal (delisted, filters changed), not the "closed right after kickoff" case this exists
// to paper over. Neither is one that's already over — the Sports page hides those anyway, so
// carrying them any longer than the match itself lasts has no purpose.
export function mergeGames(previous: Game[], fresh: Game[]): Game[] {
  const freshIds = new Set(fresh.map((g) => g.id));
  const now = Date.now();
  const survivors = previous.filter(
    (g) => !freshIds.has(g.id) && hasKickedOff(g.startTime, now) && !isOverByClock(g.startTime, now)
  );
  return [...fresh, ...survivors].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

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

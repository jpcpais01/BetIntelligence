import type { Game } from "./types";
import { hasKickedOff, isOverByClock } from "./matchClock";

const STORAGE_KEY = "betintelligence.games.v1";

// The general odds sweep (Polymarket's full event list) is manual/on-demand now, not an automatic
// timer — fetched on page load and whenever the user taps refresh, never more often than this. A
// live game's own odds are never stale by this much anyway; they're owned entirely by the Sports
// page's dedicated 10-second live-odds poll (app/sports/page.tsx), which this floor has no effect
// on. "Precision" here means exactly that: the general sweep is never asked to repeat itself
// inside a 10-minute window, on the theory that pre-match/non-live odds simply don't move fast
// enough to need it.
export const ODDS_REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000;

// Merges a fresh fetch with the previously-known list. Fresh data wins for any game it still
// contains — EXCEPT its own `odds`, which stays whatever it already was for any game in
// `liveGameIds`: that field belongs exclusively to the dedicated live-odds poll once a match has
// kicked off, and a general sweep (on a click, or the initial load) landing moments after that
// poll would otherwise overwrite genuinely-live odds with a less current snapshot — the two
// sources disagreeing about "the odds" for the same game at the same time. Everything else about
// the game (volume, liquidity, tokenIds, ...) still updates normally from the fresh fetch.
//
// A match that has kicked off but isn't over yet is kept from the previous list even when the
// fresh fetch no longer has it at all: Polymarket drops an event from its own closed:"false" feed
// within hours of kickoff, well before the match itself is done, so a plain wholesale swap made a
// live game vanish mid-match.
//
// A game that hasn't started yet and is missing from a fresh fetch is NOT preserved: that's a
// real removal (delisted, filters changed), not the "closed right after kickoff" case this exists
// to paper over. Neither is one that's already over — the Sports page hides those anyway, so
// carrying them any longer than the match itself lasts has no purpose.
export function mergeGames(previous: Game[], fresh: Game[], liveGameIds: ReadonlySet<string> = new Set()): Game[] {
  const previousById = new Map(previous.map((g) => [g.id, g]));
  const freshIds = new Set(fresh.map((g) => g.id));
  const now = Date.now();

  const merged = fresh.map((g) => {
    if (!liveGameIds.has(g.id)) return g;
    const prior = previousById.get(g.id);
    return prior ? { ...g, odds: prior.odds } : g;
  });

  const survivors = previous.filter(
    (g) => !freshIds.has(g.id) && hasKickedOff(g.startTime, now) && !isOverByClock(g.startTime, now)
  );
  return [...merged, ...survivors].sort(
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
  return Date.now() - t >= ODDS_REFRESH_MIN_INTERVAL_MS;
}

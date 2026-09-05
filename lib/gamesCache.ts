import type { Game } from "./types";

const STORAGE_KEY = "betintelligence.games.v1";

export const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

// How long a game that started in the past is still worth showing at all — mirrors the
// server's own "recently kicked off" grace intent (lib/polymarket.ts's withinWindow). That
// intent only holds if Polymarket keeps returning the event, but Polymarket appears to drop an
// event from its own closed:"false" feed well before this window elapses (reported: within
// ~5 hours of kickoff) — so a plain "replace with whatever the server just returned" wholesale
// swap silently drops a still-recent game the moment Polymarket stops offering it, regardless of
// our own grace policy never having a chance to apply. mergeGames keeps it around from the last
// fetch that did have it, for as long as this window says it's still relevant.
export const GAME_VISIBLE_GRACE_MS = 24 * 60 * 60 * 1000;

// Merges a fresh fetch with the previously-known list: fresh data always wins for any game it
// still contains, and an already-started game missing from the fresh list is kept from the
// previous list until it ages out of GAME_VISIBLE_GRACE_MS — rather than vanishing the instant
// the upstream feed stops returning it. A game that hasn't started yet and is missing from a
// fresh fetch is NOT preserved: that's a real removal (delisted, filters changed), not the
// "closed right after kickoff" case this exists to paper over.
export function mergeGames(previous: Game[], fresh: Game[]): Game[] {
  const freshIds = new Set(fresh.map((g) => g.id));
  const now = Date.now();
  const survivors = previous.filter((g) => {
    if (freshIds.has(g.id)) return false;
    const t = new Date(g.startTime).getTime();
    return Number.isFinite(t) && t <= now && now - t < GAME_VISIBLE_GRACE_MS;
  });
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

// A game is worth polling live scores for once its kickoff is close enough that it could
// plausibly be live — from 15 minutes before kickoff (so a match going live mid-session gets
// picked up promptly, without waiting on a manual refresh) through however long mergeGames above
// still keeps a kicked-off game on screen at all (GAME_VISIBLE_GRACE_MS). Defined here, sharing
// that same constant, rather than as a second copy in app/sports/page.tsx with its own hardcoded
// window — the two drifting apart is exactly what let a finished match sit on screen for hours
// with no result ever shown: its league dropped off the live-score candidate list well before the
// card itself stopped being displayed, so nothing ever polled for its final score again.
export function isLiveCandidate(startTime: string): boolean {
  const t = new Date(startTime).getTime();
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t <= now + 15 * 60_000 && t >= now - GAME_VISIBLE_GRACE_MS;
}

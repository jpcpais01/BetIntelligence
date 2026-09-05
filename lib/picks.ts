import type { SavedPick } from "./types";

const STORAGE_KEY = "betintelligence.picks.v1";

export function loadPicks(): SavedPick[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePick(pick: SavedPick): SavedPick[] {
  const existing = loadPicks();
  const next = [pick, ...existing.filter((p) => p.id !== pick.id)];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function removePick(id: string): SavedPick[] {
  const next = loadPicks().filter((p) => p.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

// How long after kickoff a match is treated as definitely over — comfortably longer than any
// real match takes, including stoppage time, extra time, and any realistic delay (the same
// "surely no longer live" window already used for live-odds polling, app/sports/page.tsx's
// LIVE_ODDS_FALLBACK_WINDOW_MS). A pure kickoff-time heuristic rather than checking the real
// match status: unlike settlement (where getting it wrong means a wrong payout), pruning a saved
// analysis is low-stakes and fully reversible by just re-analyzing, so the cost of an extra
// network round-trip on every Picks/Lab page load isn't worth it for the rare edge case (a
// postponed match) this could get wrong.
const FINISHED_GRACE_MS = 3 * 60 * 60 * 1000;

function isFinished(startTime: string): boolean {
  const t = new Date(startTime).getTime();
  return Number.isFinite(t) && Date.now() - t >= FINISHED_GRACE_MS;
}

// Once a game is over there's nothing left to bet on, so keeping its analysis around is just
// clutter — unlike a placed bet, which stays as a permanent paper-trade record even after
// settling. Called in place of loadPicks() by every page that lists saved picks, so a finished
// match's pick is pruned (and the removal persisted) the moment any of them next loads, rather
// than needing a manual delete per stale entry.
export function pruneFinishedPicks(): SavedPick[] {
  const all = loadPicks();
  const next = all.filter((p) => !isFinished(p.startTime));
  if (next.length !== all.length && typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

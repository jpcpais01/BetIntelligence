import type { SavedPick } from "./types";
import { isOverByClock } from "./matchClock";

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

// Once a game is over there's nothing left to bet on, so keeping its analysis around is just
// clutter — unlike a placed bet, which stays as a permanent paper-trade record even after
// settling. Called in place of loadPicks() by every page that lists saved picks, so a finished
// match's pick is pruned (and the removal persisted) the moment any of them next loads, rather
// than needing a manual delete per stale entry.
//
// Uses the plain kickoff-time reading of "over" (lib/matchClock.ts) rather than checking a real
// match status: unlike settlement, where getting it wrong means a wrong payout, pruning a saved
// analysis is low-stakes and fully reversible by just re-analyzing, so it isn't worth a network
// round-trip on every Picks/Lab load for the rare edge case (a postponed match) it could get wrong.
export function pruneFinishedPicks(): SavedPick[] {
  const all = loadPicks();
  const next = all.filter((p) => !isOverByClock(p.startTime));
  if (next.length !== all.length && typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

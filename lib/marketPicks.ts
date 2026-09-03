import type { SavedMarketPick } from "./types";

// Deliberately a separate store from lib/picks.ts (football's SavedPick) — Discover covers
// any Polymarket market with its own outcome shape, and keeping the two independent means
// nothing here can ever touch the football flow's storage.
const STORAGE_KEY = "betintelligence.marketPicks.v1";

export function loadMarketPicks(): SavedMarketPick[] {
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

export function saveMarketPick(pick: SavedMarketPick): SavedMarketPick[] {
  const existing = loadMarketPicks();
  const next = [pick, ...existing.filter((p) => p.id !== pick.id)];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function removeMarketPick(id: string): SavedMarketPick[] {
  const next = loadMarketPicks().filter((p) => p.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

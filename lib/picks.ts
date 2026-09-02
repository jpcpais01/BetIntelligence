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

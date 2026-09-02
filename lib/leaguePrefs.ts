import { LEAGUES } from "./leagues";
import type { LeagueId } from "./types";

const STORAGE_KEY = "betintelligence.leagues.v1";

const VALID_IDS = new Set<string>(LEAGUES.map((l) => l.id));

// An empty selection means "all leagues".
export function loadSelectedLeagues(): LeagueId[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is LeagueId => typeof id === "string" && VALID_IDS.has(id));
  } catch {
    return [];
  }
}

export function saveSelectedLeagues(ids: LeagueId[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Best effort only.
  }
}

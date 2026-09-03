import type { ComparisonResult, IndependentPrediction, Probabilities, ResearchSummary } from "./types";

// The most recent analysis for a match, keyed by game id — written automatically whenever an
// analysis completes, whether or not the user taps "Save". This is deliberately separate from
// lib/picks.ts (an explicit, permanent list the user curates): this cache is just "what did the
// AI last say about this match", overwritten every time you re-analyze it, and shown right on
// the match card so you don't have to re-run analysis just to see what you already learned.
export interface LastAnalysisEntry {
  analyzedAt: string;
  market: Probabilities;
  independent: IndependentPrediction;
  comparison: ComparisonResult;
  research?: ResearchSummary<Probabilities>;
  totalCostUsd?: number;
}

const STORAGE_KEY = "betintelligence.lastAnalysis.v1";
// Bounds how much this can grow across a long-lived browser profile — old entries for matches
// you're unlikely to revisit are evicted first.
const MAX_ENTRIES = 150;

type Store = Record<string, LastAnalysisEntry>;

export function loadLastAnalyses(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

export function getLastAnalysis(gameId: string): LastAnalysisEntry | null {
  return loadLastAnalyses()[gameId] ?? null;
}

export function saveLastAnalysis(gameId: string, entry: LastAnalysisEntry): void {
  try {
    const store = loadLastAnalyses();
    store[gameId] = entry;

    const ids = Object.keys(store);
    if (ids.length > MAX_ENTRIES) {
      const oldestFirst = ids.sort(
        (a, b) => new Date(store[a].analyzedAt).getTime() - new Date(store[b].analyzedAt).getTime()
      );
      for (const id of oldestFirst.slice(0, ids.length - MAX_ENTRIES)) delete store[id];
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage can be unavailable (private mode, quota) — the analysis just won't be cached.
  }
}

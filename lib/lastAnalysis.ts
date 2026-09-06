import type { ComparisonResult, IndependentPrediction, Probabilities, ResearchSummary } from "./types";
import { isPastRetentionWindow } from "./matchClock";

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
  // The match's own kickoff — what pruneExpiredAnalyses uses to decide "this match, and its
  // analysis, are done being shown at all" (lib/matchClock.ts's retention window: through the
  // match's own live play, plus a full day after). Undefined for an entry saved before this field
  // existed; pruneExpiredAnalyses leaves those alone rather than guessing at their match's age.
  startTime?: string;
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

// A match past its retention window (lib/matchClock.ts: through its own live play, plus a full
// day after) is done being shown anywhere, including its own last-analysis panel — call in place
// of loadLastAnalyses() wherever a page is about to read this store, so an expired entry is
// pruned (and the removal persisted) the moment any of them next loads, the same pattern
// lib/picks.ts's pruneFinishedPicks already established for saved picks. An entry with no
// startTime at all (saved before this field existed) is left alone rather than guessed at.
export function pruneExpiredAnalyses(): Store {
  const store = loadLastAnalyses();
  let changed = false;
  for (const [id, entry] of Object.entries(store)) {
    if (entry.startTime && isPastRetentionWindow(entry.startTime)) {
      delete store[id];
      changed = true;
    }
  }
  if (changed && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Best effort only — the in-memory result below is still correct for this call either way.
    }
  }
  return store;
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

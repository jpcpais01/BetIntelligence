import type { MarketComparison, MarketOutcome, MarketPrediction, OutcomeProbability, ResearchSummary } from "./types";

// Discover's counterpart to lib/lastAnalysis.ts — same idea (last analysis per market, written
// automatically on completion, shown on the card even when never explicitly saved), generalized
// for a market's arbitrary outcome labels instead of football's fixed home/draw/away shape.
export interface LastMarketAnalysisEntry {
  analyzedAt: string;
  market: MarketOutcome[];
  independent: MarketPrediction;
  comparison: MarketComparison;
  research?: ResearchSummary<OutcomeProbability[]>;
  totalCostUsd?: number;
}

const STORAGE_KEY = "betintelligence.lastMarketAnalysis.v1";
const MAX_ENTRIES = 150;

type Store = Record<string, LastMarketAnalysisEntry>;

export function loadLastMarketAnalyses(): Store {
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

export function getLastMarketAnalysis(marketId: string): LastMarketAnalysisEntry | null {
  return loadLastMarketAnalyses()[marketId] ?? null;
}

export function saveLastMarketAnalysis(marketId: string, entry: LastMarketAnalysisEntry): void {
  try {
    const store = loadLastMarketAnalyses();
    store[marketId] = entry;

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

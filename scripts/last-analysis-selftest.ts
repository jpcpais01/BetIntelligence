// Node has no localStorage — a tiny in-memory stand-in lets lib/lastAnalysis.ts and
// lib/lastMarketAnalysis.ts run their real code paths (including the JSON.parse/stringify
// round trip and the try/catch fallbacks) instead of being mocked away.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}
(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
  localStorage: new MemoryStorage(),
};

import { loadLastAnalyses, getLastAnalysis, saveLastAnalysis } from "../lib/lastAnalysis";
import { loadLastMarketAnalyses, getLastMarketAnalysis, saveLastMarketAnalysis } from "../lib/lastMarketAnalysis";
import type { IndependentPrediction, ComparisonResult, MarketPrediction, MarketComparison } from "../lib/types";

const independent: IndependentPrediction = {
  home: 0.5,
  draw: 0.3,
  away: 0.2,
  confidence: "medium",
  keyFactors: ["Form"],
  rationale: "r",
};
const comparison: ComparisonResult = {
  edges: { home: 0.05, draw: 0, away: -0.05 },
  bestValue: "home",
  confidence: "medium",
  agreesWithMarket: false,
  verdict: "v",
};

const marketPrediction: MarketPrediction = {
  outcomes: [
    { label: "Yes", probability: 0.6 },
    { label: "No", probability: 0.4 },
  ],
  confidence: "medium",
  keyFactors: ["A"],
  rationale: "r",
};
const marketComparison: MarketComparison = {
  edges: [
    { label: "Yes", edge: 0.1 },
    { label: "No", edge: -0.1 },
  ],
  bestValue: "Yes",
  confidence: "medium",
  agreesWithMarket: false,
  verdict: "v",
};

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // 1. Save + get round trip (football).
  saveLastAnalysis("game-1", {
    analyzedAt: new Date(2026, 0, 1).toISOString(),
    market: { home: 0.45, draw: 0.28, away: 0.27 },
    independent,
    comparison,
  });
  const g1 = getLastAnalysis("game-1");
  check("football: saved entry round-trips", g1?.independent.home === 0.5, JSON.stringify(g1));
  check("football: missing id returns null", getLastAnalysis("nope") === null);

  // 2. Re-saving the same id overwrites rather than duplicating.
  saveLastAnalysis("game-1", {
    analyzedAt: new Date(2026, 0, 2).toISOString(),
    market: { home: 0.45, draw: 0.28, away: 0.27 },
    independent: { ...independent, home: 0.7 },
    comparison,
  });
  const g1b = getLastAnalysis("game-1");
  check("football: re-saving the same id overwrites", g1b?.independent.home === 0.7, JSON.stringify(g1b));
  check("football: store still has exactly one entry for game-1", Object.keys(loadLastAnalyses()).length === 1);

  // 3. Cap + evict-oldest: push well past MAX_ENTRIES (150) and confirm the store stays bounded
  //    and keeps the newest entries, not an arbitrary subset.
  for (let i = 0; i < 160; i++) {
    saveLastAnalysis(`bulk-${i}`, {
      analyzedAt: new Date(2020, 0, 1 + i).toISOString(), // strictly increasing => bulk-159 is newest
      market: { home: 0.4, draw: 0.3, away: 0.3 },
      independent,
      comparison,
    });
  }
  const store = loadLastAnalyses();
  const ids = Object.keys(store);
  check("football: store is capped at 150 entries", ids.length === 150, `got ${ids.length}`);
  check("football: newest bulk entry survived", getLastAnalysis("bulk-159") !== null);
  check("football: oldest bulk entry was evicted", getLastAnalysis("bulk-0") === null);
  check(
    "football: game-1 (older than most of the bulk run but re-saved) still present",
    getLastAnalysis("game-1") !== null
  );

  // 4. Same shape of checks for the Discover market cache.
  saveLastMarketAnalysis("market-1", {
    analyzedAt: new Date(2026, 0, 1).toISOString(),
    market: [
      { label: "Yes", price: 0.55 },
      { label: "No", price: 0.45 },
    ],
    independent: marketPrediction,
    comparison: marketComparison,
  });
  const m1 = getLastMarketAnalysis("market-1");
  check("market: saved entry round-trips", m1?.independent.outcomes[0].probability === 0.6, JSON.stringify(m1));
  check("market: missing id returns null", getLastMarketAnalysis("nope") === null);

  for (let i = 0; i < 160; i++) {
    saveLastMarketAnalysis(`mkt-${i}`, {
      analyzedAt: new Date(2020, 0, 1 + i).toISOString(),
      market: [
        { label: "Yes", price: 0.5 },
        { label: "No", price: 0.5 },
      ],
      independent: marketPrediction,
      comparison: marketComparison,
    });
  }
  const mStore = loadLastMarketAnalyses();
  check("market: store is capped at 150 entries", Object.keys(mStore).length === 150, `got ${Object.keys(mStore).length}`);
  check("market: newest bulk entry survived", getLastMarketAnalysis("mkt-159") !== null);
  check("market: oldest bulk entry was evicted", getLastMarketAnalysis("mkt-0") === null);

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll last-analysis cache cases passed.");
}

run();

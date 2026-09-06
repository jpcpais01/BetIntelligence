// Node has no localStorage — a tiny in-memory stand-in lets lib/picks.ts run its real code path
// (the JSON round trip and the persisted removal) instead of being mocked away.
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

import { loadPicks, savePick, pruneFinishedPicks } from "../lib/picks";
import { MATCH_REMOVED_AFTER_MS } from "../lib/matchClock";
import type { SavedPick } from "../lib/types";

function fakePick(id: string, startTime: string): SavedPick {
  return {
    id,
    savedAt: new Date().toISOString(),
    homeTeam: `Home${id}`,
    awayTeam: `Away${id}`,
    leagueName: "Premier League",
    leagueFlag: "🏴",
    startTime,
    market: { home: 0.4, draw: 0.3, away: 0.3 },
    independent: {
      home: 0.45,
      draw: 0.28,
      away: 0.27,
      confidence: "medium",
      homeAssessment: { pros: [], cons: [] },
      awayAssessment: { pros: [], cons: [] },
      summary: "",
    },
    comparison: {
      edges: { home: 0.05, draw: -0.02, away: -0.03 },
      bestValue: "home",
      confidence: "medium",
      agreesWithMarket: false,
      verdict: "",
    },
  };
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function isoFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

const HOUR = 60 * 60 * 1000;

function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean) => {
    if (!cond) failures.push(name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // A pick stays around through its match's whole lifecycle plus a full day after it ends —
  // only a match well past THAT retention window is actually deleted, not just hidden.
  savePick(fakePick("long-gone", isoAgo(MATCH_REMOVED_AFTER_MS + HOUR)));
  savePick(fakePick("finished-recently", isoAgo(6 * HOUR)));
  savePick(fakePick("upcoming", isoFromNow(2 * HOUR)));
  savePick(fakePick("just-started", isoAgo(HOUR)));

  const pruned = pruneFinishedPicks();
  check("a match past its full retention window is pruned", !pruned.some((p) => p.id === "long-gone"));
  check(
    "a match that finished a few hours ago is still within its retention window and survives",
    pruned.some((p) => p.id === "finished-recently")
  );
  check("an upcoming match survives", pruned.some((p) => p.id === "upcoming"));
  check("a match still plausibly in progress (1h in) survives", pruned.some((p) => p.id === "just-started"));
  check("exactly one entry was removed", pruned.length === 3);

  const reloaded = loadPicks();
  check(
    "the removal is actually persisted, not just filtered in memory",
    reloaded.length === 3 && !reloaded.some((p) => p.id === "long-gone")
  );

  // A store with nothing finished doesn't rewrite storage or drop anything.
  const before = loadPicks();
  const prunedAgain = pruneFinishedPicks();
  check("pruning again with nothing finished is a no-op", prunedAgain.length === before.length);

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll picks cases passed.");
}

run();

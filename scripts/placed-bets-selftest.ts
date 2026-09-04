// Node has no localStorage — a tiny in-memory stand-in lets lib/placedBets.ts run its real code
// path (the JSON round trip and the cap-at-100 eviction) instead of being mocked away.
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

import { loadPlacedBets, placeBet } from "../lib/placedBets";
import type { SlipLeg, CombinedSlip } from "../lib/betslip";

function fakeLeg(pickId: string): SlipLeg {
  return {
    pickId,
    kind: "sports",
    title: "Arsenal v Chelsea",
    meta: "🏴 Premier League",
    outcomeLabel: "Arsenal",
    marketProb: 0.41,
    aiProb: 0.48,
  };
}

const combined: CombinedSlip = { marketProb: 0.41, aiProb: 0.48, edge: 0.07 };

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  check("empty store returns []", loadPlacedBets().length === 0);

  const bet = placeBet([fakeLeg("pick-1")], combined, 10);
  check("placeBet returns a bet with an id and timestamp", typeof bet.id === "string" && typeof bet.placedAt === "string");
  check("placeBet round-trips the legs", loadPlacedBets()[0].legs[0].pickId === "pick-1");
  check("placeBet round-trips the combined snapshot", loadPlacedBets()[0].combined.edge === 0.07);
  check("placeBet round-trips the stake", loadPlacedBets()[0].stake === 10);

  const bet2 = placeBet([fakeLeg("pick-2")], combined, 25);
  check("newest bet is prepended (most recent first)", loadPlacedBets()[0].id === bet2.id);
  check("older bet is still present", loadPlacedBets().some((b) => b.id === bet.id));

  for (let i = 0; i < 105; i++) placeBet([fakeLeg(`bulk-${i}`)], combined, 10);
  check("store is capped at 100 entries", loadPlacedBets().length === 100);
  check("newest bulk entry survived", loadPlacedBets()[0].legs[0].pickId === "bulk-104");
  check("oldest bulk entry was evicted", !loadPlacedBets().some((b) => b.legs[0].pickId === "bulk-0"));

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll placed-bets cases passed.");
}

run();

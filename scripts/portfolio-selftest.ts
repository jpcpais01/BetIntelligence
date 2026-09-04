// Node has no localStorage — a tiny in-memory stand-in lets lib/portfolio.ts run its real code
// path (the seed-once behavior, deposit persistence) instead of being mocked away.
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

import { loadDeposits, addFunds, totalDeposited, STARTING_BALANCE } from "../lib/portfolio";

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  const first = loadDeposits();
  check("first-ever load seeds one deposit at the starting balance", first.length === 1 && first[0].amount === STARTING_BALANCE);
  check("totalDeposited sums to the starting balance right after seeding", totalDeposited(first) === STARTING_BALANCE);

  const second = loadDeposits();
  check("a second load doesn't seed again (still exactly one deposit)", second.length === 1);

  const deposit = addFunds(250);
  check("addFunds returns the new deposit with the right amount", deposit.amount === 250);
  const afterAdd = loadDeposits();
  check("addFunds appends rather than replacing", afterAdd.length === 2);
  check("totalDeposited reflects both deposits", totalDeposited(afterAdd) === STARTING_BALANCE + 250);

  addFunds(100);
  check("a further deposit keeps accumulating", totalDeposited(loadDeposits()) === STARTING_BALANCE + 250 + 100);

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll portfolio cases passed.");
}

run();

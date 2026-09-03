import { getIndependentMarketPrediction, compareMarketToOdds } from "../lib/openrouterMarkets";
import type { MarketPrediction } from "../lib/types";

process.env.OPENROUTER_API_KEY = "test-key";

// A 6-way market (more realistic than football's fixed 3-outcome shape) — this is exactly the
// case the Discover feed's "several options" markets exercise, and the one place the shared
// alignment logic (resolveLabel/alignByLabel in lib/openrouterMarkets.ts) actually has to work
// for correctness, not just avoid crashing.
const LABELS = ["Brazil", "France", "Argentina", "England", "Spain", "Other"];

function completion(content: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }] }),
    text: async () => "",
  };
}

function mockFetchOnce(body: unknown) {
  globalThis.fetch = (async () => completion(JSON.stringify(body))) as unknown as typeof fetch;
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // 1. Outcomes returned out of order, with incidental whitespace/case drift — every original
  //    label must still come back, in the ORIGINAL order, summing to ~1.
  mockFetchOnce({
    outcomes: [
      { label: "other", probability: 0.1 },
      { label: "Argentina ", probability: 0.3 },
      { label: "BRAZIL", probability: 0.25 },
      { label: "France", probability: 0.15 },
      { label: "England", probability: 0.1 },
      { label: "Spain", probability: 0.1 },
    ],
    confidence: "high",
    keyFactors: ["Squad depth", "Recent form", "Draw path"],
    rationale: "Argentina and Brazil lead a competitive field.",
  });
  const p1 = await getIndependentMarketPrediction({
    title: "2026 World Cup Winner",
    category: "Sports",
    endDate: new Date(Date.now() + 200 * 86_400_000).toISOString(),
    outcomeLabels: LABELS,
  });
  check(
    "predict: preserves original label order",
    JSON.stringify(p1.outcomes.map((o) => o.label)) === JSON.stringify(LABELS)
  );
  check(
    "predict: case/whitespace-drifted labels aligned correctly",
    Math.abs(p1.outcomes.find((o) => o.label === "Argentina")!.probability - 0.3) < 0.01 &&
      Math.abs(p1.outcomes.find((o) => o.label === "Brazil")!.probability - 0.25) < 0.01
  );
  const sum1 = p1.outcomes.reduce((s, o) => s + o.probability, 0);
  check("predict: probabilities sum to ~1", Math.abs(sum1 - 1) < 0.001, `got ${sum1}`);

  // 2. AI drops an outcome entirely — it must still appear in the output (not silently vanish
  //    from the UI), and the remaining probabilities must still sum to ~1 after renormalizing.
  mockFetchOnce({
    outcomes: [
      { label: "Brazil", probability: 0.4 },
      { label: "France", probability: 0.3 },
      { label: "Argentina", probability: 0.3 },
      // England, Spain, Other omitted entirely.
    ],
    confidence: "medium",
    keyFactors: ["Top three dominate"],
    rationale: "Field narrows to three realistic contenders.",
  });
  const p2 = await getIndependentMarketPrediction({
    title: "2026 World Cup Winner",
    category: "Sports",
    endDate: new Date(Date.now() + 200 * 86_400_000).toISOString(),
    outcomeLabels: LABELS,
  });
  check("predict: omitted outcome still present in output", p2.outcomes.some((o) => o.label === "Other"));
  check("predict: omitted outcome defaults to 0 before renormalizing", (p2.outcomes.find((o) => o.label === "Other")?.probability ?? -1) === 0);
  const sum2 = p2.outcomes.reduce((s, o) => s + o.probability, 0);
  check("predict: still sums to ~1 after an omission", Math.abs(sum2 - 1) < 0.001, `got ${sum2}`);

  // 3. Compare step: bestValue paraphrased with extra text — must still resolve to the exact
  //    known label (this is the bug: bestValue used to be matched with exact-string-equality
  //    only, while every other field already tolerated this kind of drift).
  const independent: MarketPrediction = {
    outcomes: LABELS.map((label, i) => ({ label, probability: i === 0 ? 0.5 : 0.1 })),
    confidence: "high",
    keyFactors: [],
    rationale: "",
  };
  mockFetchOnce({
    edges: [
      { label: "brazil", edge: 0.15 },
      { label: "France", edge: -0.02 },
      { label: "Argentina", edge: 0.01 },
      { label: "England", edge: -0.05 },
      { label: "Spain", edge: -0.03 },
      { label: "Other", edge: -0.06 },
    ],
    bestValue: "Brazil national team", // paraphrased, not an exact match
    confidence: "high",
    agreesWithMarket: false,
    verdict: "Brazil is undervalued relative to squad quality.",
  });
  const c1 = await compareMarketToOdds({
    title: "2026 World Cup Winner",
    category: "Sports",
    independent,
    market: LABELS.map((label, i) => ({ label, price: i === 0 ? 0.35 : 0.13 })),
  });
  check("compare: paraphrased bestValue resolves to the exact known label", c1.bestValue === "Brazil", `got ${c1.bestValue}`);
  check("compare: edges cover every original label", JSON.stringify(c1.edges.map((e) => e.label)) === JSON.stringify(LABELS));

  // 4. Compare step: bestValue that matches nothing at all must resolve to null, not throw and
  //    not silently attach itself to some unrelated outcome.
  mockFetchOnce({
    edges: LABELS.map((label) => ({ label, edge: 0 })),
    bestValue: "Portugal", // not one of the offered outcomes at all
    confidence: "low",
    agreesWithMarket: true,
    verdict: "No real edge found.",
  });
  const c2 = await compareMarketToOdds({
    title: "2026 World Cup Winner",
    category: "Sports",
    independent,
    market: LABELS.map((label) => ({ label, price: 1 / LABELS.length })),
  });
  check("compare: unmatchable bestValue resolves to null", c2.bestValue === null, `got ${c2.bestValue}`);

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll multi-outcome market analysis cases passed.");
}

run();

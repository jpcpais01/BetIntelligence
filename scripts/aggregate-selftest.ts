import {
  aggregateFootballRuns,
  synthesizeFootballIndependent,
  aggregateMarketRuns,
  synthesizeMarketIndependent,
  agreementTone,
  agreementLabel,
} from "../lib/aggregate";
import type { IndependentPrediction, MarketPrediction } from "../lib/types";

function football(home: number, draw: number, away: number, extra: Partial<IndependentPrediction> = {}): IndependentPrediction {
  return {
    home,
    draw,
    away,
    confidence: "medium",
    keyFactors: ["Form"],
    rationale: `home ${home}`,
    ...extra,
  };
}

function market(outcomes: { label: string; probability: number }[], extra: Partial<MarketPrediction> = {}): MarketPrediction {
  return { outcomes, confidence: "medium", keyFactors: ["Base rate"], rationale: `top ${outcomes[0].label}`, ...extra };
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // 1. Football: three runs that all agree on the same top pick, close together.
  {
    const runs = [football(0.5, 0.3, 0.2), football(0.52, 0.28, 0.2), football(0.48, 0.32, 0.2)];
    const { average, agreement } = aggregateFootballRuns(runs);
    check("football average sums to ~1", Math.abs(average.home + average.draw + average.away - 1) < 0.001);
    check("football average home is the mean of the three runs", Math.abs(average.home - 0.5) < 0.001, `got ${average.home}`);
    check("football agreementPct is 100% when all runs pick the same top outcome", agreement.agreementPct === 1);
    check("football spread is small for tightly clustered runs", agreement.spread < 0.03, `got ${agreement.spread}`);
    check("agreementTone is high for tight consensus", agreementTone(agreement) === "high");
  }

  // 2. Football: runs that genuinely disagree on the winner.
  {
    const runs = [football(0.6, 0.2, 0.2), football(0.2, 0.2, 0.6), football(0.25, 0.5, 0.25)];
    const { agreement } = aggregateFootballRuns(runs);
    check(
      "football agreementPct drops when runs disagree on the top outcome",
      agreement.agreementPct < 1,
      `got ${agreement.agreementPct}`
    );
    check("football spread is large for scattered runs", agreement.spread > 0.1, `got ${agreement.spread}`);
    check("agreementTone is not high for scattered runs", agreementTone(agreement) !== "high");
  }

  // 3. synthesizeFootballIndependent: single run passes through untouched.
  {
    const single = football(0.4, 0.3, 0.3);
    const result = synthesizeFootballIndependent([single]);
    check("single football run passes through unchanged", result === single);
  }

  // 4. synthesizeFootballIndependent: multi-run merges keyFactors/sources and dedupes.
  {
    const runs = [
      football(0.5, 0.3, 0.2, { keyFactors: ["Injuries", "Form"], sources: [{ url: "https://a.com", title: "A" }] }),
      football(0.52, 0.28, 0.2, { keyFactors: ["form", "Squad depth"], sources: [{ url: "https://a.com", title: "A dup" }, { url: "https://b.com", title: "B" }] }),
    ];
    const merged = synthesizeFootballIndependent(runs);
    check(
      "merged keyFactors dedupes case-insensitively and preserves order",
      JSON.stringify(merged.keyFactors) === JSON.stringify(["Injuries", "Form", "Squad depth"]),
      JSON.stringify(merged.keyFactors)
    );
    check("merged sources dedupe by url", (merged.sources ?? []).length === 2, `got ${(merged.sources ?? []).length}`);
    check("merged rationale mentions the run count", merged.rationale.includes("2 independent research runs"));
    check(
      "merged probabilities are the mean of the runs",
      Math.abs(merged.home - 0.51) < 0.001,
      `got ${merged.home}`
    );
  }

  // 5. mostCommonConfidence via synthesize: majority vote.
  {
    const runs = [
      football(0.5, 0.3, 0.2, { confidence: "high" }),
      football(0.5, 0.3, 0.2, { confidence: "high" }),
      football(0.5, 0.3, 0.2, { confidence: "low" }),
    ];
    const merged = synthesizeFootballIndependent(runs);
    check("majority confidence wins (2 high vs 1 low)", merged.confidence === "high", `got ${merged.confidence}`);
  }

  // 6. Markets: label-based aggregation with an outcome count > 2, order preserved.
  {
    const labels = ["Brazil", "Argentina", "France"];
    const runs = [
      market(labels.map((l, i) => ({ label: l, probability: [0.5, 0.3, 0.2][i] }))),
      market(labels.map((l, i) => ({ label: l, probability: [0.4, 0.4, 0.2][i] }))),
    ];
    const { average, agreement } = aggregateMarketRuns(runs);
    check(
      "market average preserves original label order",
      JSON.stringify(average.map((o) => o.label)) === JSON.stringify(labels)
    );
    check("market average Brazil is the mean of the two runs", Math.abs(average[0].probability - 0.45) < 0.001);
    check("market agreementPct is 100% — both runs pick Brazil as top", agreement.agreementPct === 1);
  }

  // 7. Markets: synthesize merges + a run whose top pick disagrees with the average lowers agreement.
  {
    const labels = ["Yes", "No"];
    const runs = [
      market(labels.map((l, i) => ({ label: l, probability: [0.7, 0.3][i] }))),
      market(labels.map((l, i) => ({ label: l, probability: [0.65, 0.35][i] }))),
      market(labels.map((l, i) => ({ label: l, probability: [0.2, 0.8][i] }))),
    ];
    const merged = synthesizeMarketIndependent(runs);
    const { agreement } = aggregateMarketRuns(runs);
    check(
      "market agreementPct reflects the 2-of-3 majority",
      Math.abs(agreement.agreementPct - 2 / 3) < 0.001,
      `got ${agreement.agreementPct}`
    );
    check(
      "merged market outcomes still sum to ~1",
      Math.abs(merged.outcomes.reduce((s, o) => s + o.probability, 0) - 1) < 0.001
    );
  }

  // 8. agreementLabel text reflects tone.
  {
    const high = { runCount: 3, agreementPct: 1, spread: 0.01 };
    const low = { runCount: 3, agreementPct: 0.33, spread: 0.25 };
    check("agreementLabel for high tone mentions strong agreement", agreementLabel(high).toLowerCase().includes("strong"));
    check("agreementLabel for low tone mentions split", agreementLabel(low).toLowerCase().includes("split"));
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll aggregation cases passed.");
}

run();

import {
  legMultiplier,
  computeEdgeScore,
  resolvedLegOutcomes,
  overallEdgeScore,
  edgeScoreByRiskLevel,
} from "../lib/edgeScore";
import type { PlacedBet } from "../lib/placedBets";
import type { SlipLeg } from "../lib/betslip";

function leg(marketProb: number, kind: SlipLeg["kind"] = "sports"): SlipLeg {
  return {
    pickId: `p-${marketProb}-${kind}`,
    kind,
    title: "Home v Away",
    meta: "🏴 Premier League",
    outcomeLabel: "Home",
    marketProb,
    aiProb: marketProb,
  };
}

function bet(legs: SlipLeg[], legResults?: PlacedBet["legResults"]): PlacedBet {
  return {
    id: `bet-${Math.random()}`,
    placedAt: new Date().toISOString(),
    legs,
    combined: { marketProb: 1, aiProb: 1, edge: 0 },
    stake: 10,
    legResults,
  };
}

function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

  // --- legMultiplier: the core formula ---
  check("a win multiplies by 1/p", close(legMultiplier({ probability: 0.4, won: true }), 1 / 0.4));
  check(
    "a loss multiplies by (1-p), not p and not 1/(1-p)",
    close(legMultiplier({ probability: 0.4, won: false }), 0.6)
  );
  check(
    "every win multiplies by something >= 1 — a win never shrinks the score",
    legMultiplier({ probability: 0.4, won: true }) >= 1 && legMultiplier({ probability: 0.95, won: true }) >= 1
  );
  check(
    "every loss multiplies by something < 1 — a loss never grows the score",
    legMultiplier({ probability: 0.4, won: false }) < 1 && legMultiplier({ probability: 0.05, won: false }) < 1
  );
  check(
    "losing a heavy favorite (90%) costs far more than losing a longshot (20%) — a smaller multiplier is a bigger cost",
    legMultiplier({ probability: 0.9, won: false }) < legMultiplier({ probability: 0.2, won: false })
  );
  check(
    "winning a longshot (20%) pays far more than winning a heavy favorite (90%)",
    legMultiplier({ probability: 0.2, won: true }) > legMultiplier({ probability: 0.9, won: true })
  );
  check("a degenerate 0% probability never divides by zero or explodes", legMultiplier({ probability: 0, won: true }) === 1);

  // --- computeEdgeScore: empty vs populated ---
  check("no outcomes at all returns null, not 1 (no data, not break-even)", computeEdgeScore([]) === null);
  check(
    "two wins compound multiplicatively",
    close(computeEdgeScore([{ probability: 0.5, won: true }, { probability: 0.25, won: true }])!, (1 / 0.5) * (1 / 0.25))
  );

  // --- resolvedLegOutcomes: what counts, from real PlacedBet shapes ---
  {
    const bets: PlacedBet[] = [
      bet([leg(0.5)], ["won"]),
      bet([leg(0.3)], ["lost"]),
      bet([leg(0.6)]), // no legResults at all yet — nothing to count
      bet([leg(0.7)], ["pending"]),
      bet([leg(0.4), leg(0.9)], ["won", "pending"]), // one leg resolved, the other still open
      bet([leg(0.55, "market")], ["won"]), // a Discover/market leg never actually resolves in this app
    ];
    const outcomes = resolvedLegOutcomes(bets);
    check("only actually-resolved football legs are counted", outcomes.length === 3, String(outcomes.length));
    check(
      "a market-kind leg is excluded even if legResults claims it won",
      !outcomes.some((o) => o.probability === 0.55),
      JSON.stringify(outcomes)
    );
    check(
      "a still-pending leg inside an otherwise-resolved bet is excluded, its sibling leg still counted",
      outcomes.some((o) => o.probability === 0.4 && o.won) && !outcomes.some((o) => o.probability === 0.9),
      JSON.stringify(outcomes)
    );
  }

  // --- The exact scenario the feature exists for: a calm leg that WON inside a bet that overall
  // LOST still counts toward "calm", even though the bet itself never shows as a win. ---
  {
    // A 2-leg parlay: a calm favorite (won) + a mega longshot (lost) — the whole bet is Lost, but
    // the calm leg's own result is still "won".
    const bets: PlacedBet[] = [bet([leg(0.8), leg(0.1)], ["won", "lost"])];
    const byLevel = edgeScoreByRiskLevel(bets);
    const calm = byLevel.find((b) => b.level === "calm")!;
    const mega = byLevel.find((b) => b.level === "mega")!;
    check("the calm leg counts as a win for its own tier despite the parlay losing overall", calm.legCount === 1 && calm.score !== null && calm.score > 1, JSON.stringify(calm));
    check("the mega leg counts as a loss for its own tier", mega.legCount === 1 && mega.score !== null && mega.score < 1, JSON.stringify(mega));
  }

  // --- edgeScoreByRiskLevel: every tier is represented, even with zero legs ---
  {
    const byLevel = edgeScoreByRiskLevel([]);
    check("every risk tier is represented even with no bets at all", byLevel.length === 5, String(byLevel.length));
    check("a tier with no legs has a null score, not zero or one", byLevel.every((b) => b.score === null && b.legCount === 0));
  }

  // --- overallEdgeScore mirrors computeEdgeScore(resolvedLegOutcomes(...)) ---
  {
    const bets: PlacedBet[] = [bet([leg(0.5)], ["won"]), bet([leg(0.25)], ["lost"])];
    const expected = (1 / 0.5) * (1 - 0.25);
    check("overallEdgeScore combines every resolved leg across every bet", close(overallEdgeScore(bets)!, expected), String(overallEdgeScore(bets)));
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll edge-score cases passed.");
}

run();

import {
  legMultiplier,
  computeEdgeScore,
  resolvedLegOutcomes,
  overallEdgeScore,
  edgeScoreByRiskLevel,
} from "../lib/edgeScore";
import type { PlacedBet } from "../lib/placedBets";
import type { SlipLeg } from "../lib/betslip";

function leg(marketProb: number, kind: SlipLeg["kind"] = "sports", overrides: Partial<SlipLeg> = {}): SlipLeg {
  return {
    pickId: `p-${marketProb}-${kind}`,
    kind,
    title: "Home v Away",
    meta: "🏴 Premier League",
    outcomeLabel: "Home",
    marketProb,
    aiProb: marketProb,
    ...overrides,
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

  // --- The actual bug report: the same game+outcome bet across two different slips (a single
  // bet, and the same pick reused as one leg of an unrelated parlay) must only count once toward
  // the Edge Score, not be multiplied in twice just because it was staked on twice. ---
  {
    const arsenalWin = leg(0.6, "sports", { pickId: "arsenal-v-chelsea", outcomeLabel: "Arsenal" });
    const bets: PlacedBet[] = [
      bet([arsenalWin], ["won"]), // a standalone single bet on Arsenal to win
      bet([{ ...arsenalWin }, leg(0.5, "sports", { pickId: "other-game" })], ["won", "won"]), // Arsenal reused as one leg of a different parlay
    ];
    const outcomes = resolvedLegOutcomes(bets);
    check(
      "the same (pickId, outcomeLabel) across two different bets counts only once",
      outcomes.filter((o) => o.probability === 0.6).length === 1,
      JSON.stringify(outcomes)
    );
    check(
      "the unrelated leg from the second bet still counts on its own",
      outcomes.some((o) => o.probability === 0.5),
      JSON.stringify(outcomes)
    );
    const expected = (1 / 0.6) * (1 / 0.5); // Arsenal counted ONCE, not twice
    check(
      "overallEdgeScore reflects the deduplicated count, not one multiplication per bet",
      close(overallEdgeScore(bets)!, expected),
      `${overallEdgeScore(bets)} vs expected ${expected}`
    );

    // Same game, but a genuinely different outcome type on it (a double-chance leg alongside the
    // straight one) — that's a different bet on the same match and must NOT be merged away.
    const doubleChanceOnSameGame = leg(0.85, "sports", { pickId: "arsenal-v-chelsea", outcomeLabel: "1X" });
    const withDoubleChance = resolvedLegOutcomes([bet([arsenalWin, doubleChanceOnSameGame], ["won", "won"])]);
    check(
      "a different outcomeLabel on the same game (1X vs Arsenal) is kept as a separate entry, not merged",
      withDoubleChance.length === 2,
      JSON.stringify(withDoubleChance)
    );
  }

  // --- The exact scenario the feature exists for: a calm leg that WON inside a bet that overall
  // LOST still counts toward "calm", even though the bet itself never shows as a win. Risk tier is
  // read from the AI-vs-market EDGE (aiProb - marketProb) AND isFavorite (calm is favorite-only —
  // see lib/riskModes.ts's riskModeFor), not marketProb alone — leg()'s default aiProb=marketProb
  // would give every leg here a flat 0 edge (always "mega"), so both legs override aiProb
  // explicitly to land in the tiers the test is actually about, and the calm leg also sets
  // isFavorite: true since a "calm" classification requires it. ---
  {
    // A 2-leg parlay: a calm-edge favorite (15pp edge, won) + a mega-edge longshot (1pp edge,
    // lost) — the whole bet is Lost, but the calm leg's own result is still "won".
    const bets: PlacedBet[] = [
      bet([leg(0.8, "sports", { aiProb: 0.95, isFavorite: true }), leg(0.1, "sports", { aiProb: 0.11 })], ["won", "lost"]),
    ];
    const byLevel = edgeScoreByRiskLevel(bets);
    const calm = byLevel.find((b) => b.level === "calm")!;
    const mega = byLevel.find((b) => b.level === "mega")!;
    check("the calm leg counts as a win for its own tier despite the parlay losing overall", calm.legCount === 1 && calm.score !== null && calm.score > 1, JSON.stringify(calm));
    check("the mega leg counts as a loss for its own tier", mega.legCount === 1 && mega.score !== null && mega.score < 1, JSON.stringify(mega));
  }

  // --- Calm/Easy are favorite-only (lib/riskModes.ts): the SAME huge edge that landed in "calm"
  // above never does without isFavorite set — it falls through to "normal" instead, the highest
  // non-favorite-restricted tier the edge clears, never an unclassified gap. Also covers a leg
  // saved before `isFavorite` existed (the field simply absent, not explicitly false): it must
  // read the same conservative way, never retroactively granted a favorite-only tier. ---
  {
    const noFavoriteFlag = leg(0.8, "sports", { aiProb: 0.95 }); // isFavorite omitted entirely
    const explicitlyNotFavorite = leg(0.8, "sports", { aiProb: 0.95, isFavorite: false });
    const outcomes = resolvedLegOutcomes([
      bet([noFavoriteFlag], ["won"]),
      bet([{ ...explicitlyNotFavorite, pickId: "other-game-2" }], ["won"]),
    ]);
    check(
      "a 15pp-edge leg with isFavorite omitted (pre-existing data) never lands in calm",
      outcomes.every((o) => o.riskMode === "normal"),
      JSON.stringify(outcomes)
    );
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

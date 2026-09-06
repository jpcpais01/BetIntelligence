import type { PlacedBet } from "./placedBets";
import { riskLevelFor, allRiskLevels, type RiskLevel } from "./riskLevel";

export interface ResolvedLegOutcome {
  // Market probability of the side that was actually backed.
  probability: number;
  won: boolean;
}

// The "fair-odds" multiplier for one resolved leg. A win multiplies by 1/p — exactly the payout a
// flat stake at that market's own odds would have returned, so a longshot that hits rewards the
// score far more than a favorite that hits. A loss multiplies by (1-p) itself, not 1/(1-p): the
// probability of the side that DID happen was never the point of a loss, only how surprising the
// miss was — losing a bet the market gave 90% to (a real upset) shrinks the score to a tenth,
// while losing a longshot the market only gave 20% to (the expected result most of the time)
// barely dents it. Both directions are deliberate: a win always multiplies by something >= 1, a
// loss always by something < 1, so the running product only grows on genuinely good calls.
export function legMultiplier(outcome: ResolvedLegOutcome): number {
  if (outcome.won) {
    // A 0% market probability winning is a data anomaly, never a real signal — skip it rather
    // than divide by zero and blow the whole product up to Infinity over one bad number.
    return outcome.probability <= 0 ? 1 : 1 / outcome.probability;
  }
  return 1 - outcome.probability;
}

// The running product across every given leg — null (not 1) when there's nothing resolved yet,
// so a caller can tell "no data" apart from "exactly break-even".
export function computeEdgeScore(outcomes: ResolvedLegOutcome[]): number | null {
  if (outcomes.length === 0) return null;
  return outcomes.reduce((product, o) => product * legMultiplier(o), 1);
}

// Every leg across every placed bet that has actually resolved on its own — a leg counts the
// moment IT settles, regardless of whether the bet it belongs to has (PlacedBet.legResults can
// show one leg won or lost while the parlay's other legs are still pending, or even already
// lost). Market/Discover legs never resolve at all here (settlement only ever confirms football
// legs, lib/settlement.ts), so they're excluded rather than treated as perpetually pending.
//
// Deduplicated by (pickId, outcomeLabel) — the same real-world game+side backed across more than
// one bet (a single bet on "Arsenal", and Arsenal also picked as one leg of an unrelated parlay)
// is one genuine prediction, not two: without this, the Edge Score multiplied it into the product
// once per bet it happened to appear in, inflating or deflating the score purely by how many
// slips you'd reused that same pick in, not by how many independent calls you'd actually made.
// `marketProb` is a frozen snapshot from the underlying SavedPick at the moment each leg was
// added, so every duplicate is guaranteed to agree on it — keeping the first occurrence is
// exactly as correct as any other. A different outcomeLabel on the same pick (e.g. "Arsenal" vs
// "1X") is a genuinely different bet on the same game and is deliberately NOT merged.
export function resolvedLegOutcomes(bets: PlacedBet[]): (ResolvedLegOutcome & { riskLevel: RiskLevel })[] {
  const outcomes: (ResolvedLegOutcome & { riskLevel: RiskLevel })[] = [];
  const seen = new Set<string>();
  for (const bet of bets) {
    if (!bet.legResults) continue;
    bet.legs.forEach((leg, i) => {
      if (leg.kind !== "sports") return;
      const result = bet.legResults?.[i];
      if (result !== "won" && result !== "lost") return;
      const dedupeKey = `${leg.pickId}:${leg.outcomeLabel}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      outcomes.push({
        probability: leg.marketProb,
        won: result === "won",
        riskLevel: riskLevelFor(leg.marketProb),
      });
    });
  }
  return outcomes;
}

export function overallEdgeScore(bets: PlacedBet[]): number | null {
  return computeEdgeScore(resolvedLegOutcomes(bets));
}

export interface EdgeScoreByLevel {
  level: RiskLevel;
  score: number | null;
  legCount: number;
}

// One score per risk tier, each computed purely from the legs that fall in it — a calm leg that
// won still counts toward "calm" even if it was bundled into a parlay that lost overall, and a
// mega leg that lost still counts toward "mega" even inside a bet whose other legs won. This is
// the whole point: to see whether any one risk tier is actually carrying (or dragging) results,
// not just how the bets as placed happened to turn out.
export function edgeScoreByRiskLevel(bets: PlacedBet[]): EdgeScoreByLevel[] {
  const outcomes = resolvedLegOutcomes(bets);
  return allRiskLevels().map((level) => {
    const forLevel = outcomes.filter((o) => o.riskLevel === level);
    return { level, score: computeEdgeScore(forLevel), legCount: forLevel.length };
  });
}

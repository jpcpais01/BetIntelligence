import type { LastAnalysisEntry } from "./lastAnalysis";
import type { LeagueId } from "./types";
import type { SlipLeg } from "./betslip";
import { isMarketFavorite, riskModeFor, allRiskModes, type RiskMode } from "./riskModes";
import { legResult, fetchScores, type LegResult } from "./settlement";
import { computeEdgeScore, type ResolvedLegOutcome } from "./edgeScore";
import { MAX_SETTLEMENT_LOOKBACK_MS } from "./liveScores";

// The Overview page's whole premise: grade every game the AI has EVER analyzed (not just the ones
// actually staked), as if each had been bet on individually, one flat stake per game — the same
// Edge Score math already used for real placed bets (lib/edgeScore.ts), just applied to the full
// analysis history instead of only what was actually risked. Two independent strategies per game:
export type OverviewStrategy = "straight" | "combo";

// - "straight": literally the AI's own actual recommendation (comparison.bestValue) — the exact
//   same read the GameCard badge and the Edge Score breakdown already use, just extended to every
//   analyzed game rather than only ones with a placed bet.
// - "combo": NOT derived from bestValue (a "draw" recommendation has no natural double-chance
//   analog — both 1X and X2 equally contain it) — instead, independently searches the two
//   double-chance combos for whichever has the better edge, the same edge-maximization
//   lib/riskModes.ts's own bestCandidateForPick already uses for Lab's "any outcome" presets, just
//   narrowed to the combo pool alone. A combo can never be "the favorite" (lib/betslip.ts's
//   isMarketFavorite is never asked about one — a combo is definitionally more likely than either
//   side it covers, so it would trivially "look like" the favorite without being what the market
//   actually picked), so under riskModeFor a combo NEVER lands in Calm or Easy — those two tiers
//   are favorite-only by design. That's not a gap in this page; it's the same rule Lab's own
//   presets already live by, just visible here as a structurally-always-empty cell rather than a
//   coincidence.
//
// A game only enters either strategy at all once the AI actually found something worth
// recommending (comparison.bestValue !== "none") — "unclassed" (no meaningful edge on any side) is
// the one real exclusion; every classed game lands in exactly one of the five tiers per strategy,
// there is no sixth "doesn't fit anywhere" bucket (riskModeFor's own Mega tier is the catch-all
// bottom for that reason).

interface Hypothetical {
  mode: RiskMode;
  strategy: OverviewStrategy;
  probability: number;
  leg: SlipLeg;
}

function bestComboLeg(
  gameId: string,
  entry: Required<Pick<LastAnalysisEntry, "market" | "independent" | "homeTeam" | "awayTeam" | "league" | "startTime">> &
    Pick<LastAnalysisEntry, "leagueFlag" | "leagueName">
): Hypothetical {
  const { market, independent, homeTeam, awayTeam, league, startTime, leagueFlag, leagueName } = entry;
  const oneXEdge = independent.home + independent.draw - (market.home + market.draw);
  const x2Edge = independent.draw + independent.away - (market.draw + market.away);
  const useOneX = oneXEdge >= x2Edge;
  const outcomeLabel = useOneX ? "1X" : "X2";
  const probability = useOneX ? market.home + market.draw : market.draw + market.away;
  const aiProb = useOneX ? independent.home + independent.draw : independent.draw + independent.away;
  const edge = useOneX ? oneXEdge : x2Edge;
  return {
    mode: riskModeFor(edge, false),
    strategy: "combo",
    probability,
    leg: {
      pickId: gameId,
      kind: "sports",
      title: `${homeTeam} v ${awayTeam}`,
      meta: `${leagueFlag ?? ""} ${leagueName ?? ""}`.trim(),
      outcomeLabel,
      marketProb: probability,
      aiProb,
      league,
      homeTeam,
      awayTeam,
      startTime,
    },
  };
}

function straightLeg(
  gameId: string,
  entry: Required<Pick<LastAnalysisEntry, "market" | "independent" | "comparison" | "homeTeam" | "awayTeam" | "league" | "startTime">> &
    Pick<LastAnalysisEntry, "leagueFlag" | "leagueName">
): Hypothetical | null {
  const { comparison, market, independent, homeTeam, awayTeam, league, startTime, leagueFlag, leagueName } = entry;
  const outcome = comparison.bestValue;
  if (outcome === "none") return null;
  const outcomeLabel = outcome === "draw" ? "Draw" : outcome === "home" ? homeTeam : awayTeam;
  return {
    mode: riskModeFor(comparison.edges[outcome], isMarketFavorite(market, outcome)),
    strategy: "straight",
    probability: market[outcome],
    leg: {
      pickId: gameId,
      kind: "sports",
      title: `${homeTeam} v ${awayTeam}`,
      meta: `${leagueFlag ?? ""} ${leagueName ?? ""}`.trim(),
      outcomeLabel,
      marketProb: market[outcome],
      aiProb: independent[outcome],
      league,
      homeTeam,
      awayTeam,
      startTime,
    },
  };
}

// Every hypothetical bet the analysis history actually supports — skips an entry saved before
// match identity was tracked (undefined league/homeTeam/awayTeam/startTime, see lib/lastAnalysis.ts)
// since there's no way to look up that match's real result at all, and skips one with no
// recommendation to rate (bestValue "none") for the straight leg specifically (a combo leg is
// still built independently — see the module doc above for why bestValue doesn't gate it).
function buildHypotheticals(analyses: Record<string, LastAnalysisEntry>): Hypothetical[] {
  const out: Hypothetical[] = [];
  for (const [gameId, entry] of Object.entries(analyses)) {
    const { league, homeTeam, awayTeam, startTime } = entry;
    if (!league || !homeTeam || !awayTeam || !startTime) continue;
    const complete = { ...entry, league, homeTeam, awayTeam, startTime };
    const straight = straightLeg(gameId, complete);
    if (straight) out.push(straight);
    out.push(bestComboLeg(gameId, complete));
  }
  return out;
}

function settlementRefsFor(hypotheticals: Hypothetical[], now: number): { league: LeagueId; earliestKickoff: string }[] {
  const earliestByLeague = new Map<LeagueId, string>();
  for (const h of hypotheticals) {
    const { league, startTime } = h.leg;
    if (!league || !startTime) continue;
    const kickoff = new Date(startTime).getTime();
    if (!Number.isFinite(kickoff) || now - kickoff > MAX_SETTLEMENT_LOOKBACK_MS) continue;
    const current = earliestByLeague.get(league);
    if (!current || kickoff < new Date(current).getTime()) earliestByLeague.set(league, startTime);
  }
  return [...earliestByLeague.entries()].map(([league, earliestKickoff]) => ({ league, earliestKickoff }));
}

export interface OverviewCell {
  mode: RiskMode;
  strategy: OverviewStrategy;
  score: number | null;
  resolvedCount: number;
  pendingCount: number;
}

export interface OverviewResult {
  cells: OverviewCell[]; // exactly 10: allRiskModes() × ["straight", "combo"]
  totalAnalyzed: number; // distinct games that entered the pipeline at all (had usable identity)
  totalResolved: number;
  totalPending: number;
  overallScore: number | null; // every resolved leg from every tier/strategy combined, one number
}

// Runs entirely client-side, same best-effort contract as lib/settlement.ts's own resolution: a
// failed or empty score fetch just means everything shows as pending this round, never a thrown
// error or a guessed result. Only ever reads real, finished match scores — nothing here is
// inferred from a live-trading market price.
export async function computeOverview(analyses: Record<string, LastAnalysisEntry>, now: number = Date.now()): Promise<OverviewResult> {
  const hypotheticals = buildHypotheticals(analyses);
  const refs = settlementRefsFor(hypotheticals, now);
  const scores = await fetchScores(refs);

  const byBucket = new Map<string, (ResolvedLegOutcome & { result: LegResult })[]>();
  let totalResolved = 0;
  let totalPending = 0;
  const allResolved: ResolvedLegOutcome[] = [];

  for (const h of hypotheticals) {
    const result = legResult(h.leg, scores);
    const key = `${h.mode}:${h.strategy}`;
    const bucket = byBucket.get(key) ?? [];
    bucket.push({ probability: h.probability, won: result === "won", result });
    byBucket.set(key, bucket);
    if (result === "pending") {
      totalPending++;
    } else {
      totalResolved++;
      allResolved.push({ probability: h.probability, won: result === "won" });
    }
  }

  const cells: OverviewCell[] = [];
  for (const mode of allRiskModes()) {
    for (const strategy of ["straight", "combo"] as const) {
      const bucket = byBucket.get(`${mode}:${strategy}`) ?? [];
      const resolved = bucket.filter((b) => b.result !== "pending");
      const pending = bucket.filter((b) => b.result === "pending");
      cells.push({
        mode,
        strategy,
        score: computeEdgeScore(resolved),
        resolvedCount: resolved.length,
        pendingCount: pending.length,
      });
    }
  }

  return {
    cells,
    totalAnalyzed: hypotheticals.length > 0 ? new Set(hypotheticals.map((h) => h.leg.pickId)).size : 0,
    totalResolved,
    totalPending,
    overallScore: computeEdgeScore(allResolved),
  };
}

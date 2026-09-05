import type { SlipLeg } from "./betslip";
import type { PlacedBet } from "./placedBets";
import { applySettlements } from "./placedBets";
import type { LiveScoreEntry } from "./footballData";
import type { LeagueId } from "./types";
import { teamNamesMatch } from "./teamNameMatching";

export type LegResult = "won" | "lost" | "pending";

function findMatch(leg: SlipLeg, scores: LiveScoreEntry[]): LiveScoreEntry | null {
  if (leg.kind !== "sports" || !leg.league || !leg.homeTeam || !leg.awayTeam) return null;
  return (
    scores.find(
      (s) =>
        s.league === leg.league &&
        teamNamesMatch(s.homeTeam, leg.homeTeam as string) &&
        teamNamesMatch(s.awayTeam, leg.awayTeam as string)
    ) ?? null
  );
}

// A market (Discover) leg, or a football leg missing the identifying fields older picks predate
// (league/homeTeam/awayTeam), or one whose match hasn't been confirmed FINISHED yet, is "pending"
// — never guessed at. Only a real, final score decides won/lost.
export function legResult(leg: SlipLeg, scores: LiveScoreEntry[]): LegResult {
  const match = findMatch(leg, scores);
  if (!match || match.status !== "FINISHED" || match.homeGoals === null || match.awayGoals === null) {
    return "pending";
  }
  const { homeGoals, awayGoals } = match;
  if (leg.outcomeLabel === "Draw") return homeGoals === awayGoals ? "won" : "lost";
  if (leg.outcomeLabel === "1X") return homeGoals >= awayGoals ? "won" : "lost";
  if (leg.outcomeLabel === "X2") return homeGoals <= awayGoals ? "won" : "lost";
  if (teamNamesMatch(leg.outcomeLabel, leg.homeTeam as string)) return homeGoals > awayGoals ? "won" : "lost";
  if (teamNamesMatch(leg.outcomeLabel, leg.awayTeam as string)) return awayGoals > homeGoals ? "won" : "lost";
  return "pending";
}

export interface BetOutcome {
  status: "won" | "lost";
  payout: number;
}

// A parlay settles LOST the moment any leg is confirmed lost, regardless of the others — no need
// to wait on a still-open leg once the bet can no longer possibly win. It only settles WON once
// EVERY leg is confirmed won; a bet with any market leg can never reach that (no resolution source
// for those), so it just stays open forever — deliberate, not a gap, same as before this existed.
export function settleBet(bet: PlacedBet, scores: LiveScoreEntry[]): BetOutcome | null {
  const results = bet.legs.map((leg) => legResult(leg, scores));
  if (results.some((r) => r === "lost")) return { status: "lost", payout: 0 };
  if (results.length > 0 && results.every((r) => r === "won")) {
    const payout = bet.combined.marketProb > 0 ? bet.stake / bet.combined.marketProb : bet.stake;
    return { status: "won", payout };
  }
  return null;
}

function settlementRefs(bets: PlacedBet[]): { league: LeagueId; earliestKickoff: string }[] {
  const earliestByLeague = new Map<LeagueId, string>();
  for (const bet of bets) {
    if (bet.settlement) continue;
    for (const leg of bet.legs) {
      if (leg.kind !== "sports" || !leg.league || !leg.startTime) continue;
      const current = earliestByLeague.get(leg.league);
      if (!current || new Date(leg.startTime).getTime() < new Date(current).getTime()) {
        earliestByLeague.set(leg.league, leg.startTime);
      }
    }
  }
  return [...earliestByLeague.entries()].map(([league, earliestKickoff]) => ({ league, earliestKickoff }));
}

// Fetches real match results for every league a still-open placed bet touches, settles whatever
// that resolves, persists it, and returns bets with settlement filled in. Best-effort: a failed
// fetch just leaves every bet exactly as it was (still open), same as any other best-effort
// enrichment in this app — never invents an outcome from missing data.
export async function resolvePendingSettlements(bets: PlacedBet[]): Promise<PlacedBet[]> {
  const refs = settlementRefs(bets);
  if (refs.length === 0) return bets;

  try {
    const res = await fetch("/api/bets/settlement-scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs }),
      cache: "no-store",
    });
    if (!res.ok) return bets;
    const data = await res.json();
    const scores: LiveScoreEntry[] = Array.isArray(data.scores) ? data.scores : [];
    if (scores.length === 0) return bets;

    const updates: Record<string, BetOutcome> = {};
    for (const bet of bets) {
      if (bet.settlement) continue;
      const outcome = settleBet(bet, scores);
      if (outcome) updates[bet.id] = outcome;
    }
    if (Object.keys(updates).length === 0) return bets;
    return applySettlements(updates);
  } catch {
    return bets;
  }
}

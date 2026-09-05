import type { SlipLeg } from "./betslip";
import type { PlacedBet } from "./placedBets";
import { applySettlements, applyLegResults } from "./placedBets";
import type { LiveScoreEntry } from "./footballData";
import type { LeagueId } from "./types";
import { teamNamesMatch, anyTeamNameMatches } from "./teamNameMatching";
import { leagueIdByName } from "./leagues";

export type LegResult = "won" | "lost" | "pending";

// A leg placed before it started carrying its own league/homeTeam/awayTeam/startTime would
// otherwise never be checked at all: settlementRefs below silently skips anything missing these,
// so a genuinely finished match's bet just sat as "Pending" forever with no way to ever notice it
// — that's the exact bug this fixes. Every leg has always carried `title` ("Home v Away", set once
// at leg-creation and never since changed) and `meta` ("🏴 League Name"), and every bet has always
// carried `placedAt` — recovered from those instead of needing the user to somehow fix data
// already sitting in their own browser storage.
function backfillLeg(leg: SlipLeg, placedAt: string): SlipLeg {
  if (leg.kind !== "sports") return leg;
  let { league, homeTeam, awayTeam, startTime } = leg;
  if ((!homeTeam || !awayTeam) && leg.title.includes(" v ")) {
    const [h, a] = leg.title.split(" v ");
    homeTeam = homeTeam ?? h?.trim();
    awayTeam = awayTeam ?? a?.trim();
  }
  if (!league) {
    // meta is "<flag emoji> <league name>" — strip the leading flag (never itself whitespace,
    // however many codepoints it's made of) and the space after it to recover the plain league
    // name leagueIdByName expects.
    league = leagueIdByName(leg.meta.replace(/^\S+\s*/u, "").trim());
  }
  // A bet is never placed after its own match kicked off (Lab hides a started game from the
  // build list), so placedAt is always a safe — if conservative — stand-in lower bound: it can
  // only widen how far back a lookup searches, never miss the real kickoff by searching too
  // narrow a window.
  startTime = startTime ?? placedAt;
  return { ...leg, league, homeTeam, awayTeam, startTime };
}

function backfilledLegs(bet: PlacedBet): SlipLeg[] {
  return bet.legs.map((leg) => backfillLeg(leg, bet.placedAt));
}

// A bet settles from exactly one source of truth: the real, final score of the match it was
// placed on. Nothing is inferred from Polymarket's own price — a side trading like the winner
// isn't the same thing as having won, and settling from a number that's still moving is how a bet
// gets called the wrong way. "Is the game finished?" is the only question this asks.

// Matched against both the full and short club names the provider gives, not just the full one:
// several clubs are only recognisable from Polymarket's naming under the short form ("Wolves",
// "Spurs", "Inter Milan"), and checking the full name alone meant a bet on one of those never
// found its own match and so sat unsettled no matter how long ago it finished.
function findMatch(leg: SlipLeg, scores: LiveScoreEntry[]): LiveScoreEntry | null {
  if (leg.kind !== "sports" || !leg.league || !leg.homeTeam || !leg.awayTeam) return null;
  const { homeTeam, awayTeam } = leg;
  return (
    scores.find(
      (s) =>
        s.league === leg.league &&
        anyTeamNameMatches([s.homeTeam, s.homeTeamShort], homeTeam) &&
        anyTeamNameMatches([s.awayTeam, s.awayTeamShort], awayTeam)
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

// Per-leg results — independent of whether the WHOLE bet has settled, and exported so the "My
// Bets" list can color an individual leg green/red the moment ITS OWN match resolves, well before
// (or even instead of, if the bet ends up Lost) the parlay as a whole ever does.
//
// A leg already resolved won/lost on a PREVIOUS check is never recomputed — that result is final
// (a finished match's score doesn't change), so it's just carried forward from `bet.legResults`
// rather than asking again. Only a leg still "pending" gets a fresh look each time. This is what
// makes the recurring check cheap: a parlay with one match still to finish only ever needs that
// one match's score, however many times it's rechecked while waiting.
export function computeLegResults(bet: PlacedBet, scores: LiveScoreEntry[]): LegResult[] {
  const cached = bet.legResults ?? [];
  return backfilledLegs(bet).map((leg, i) => {
    if (cached[i] === "won" || cached[i] === "lost") return cached[i];
    return legResult(leg, scores);
  });
}

// A parlay settles LOST the moment any leg is confirmed lost, regardless of the others — no need
// to wait on a still-open leg once the bet can no longer possibly win. It only settles WON once
// EVERY leg is confirmed won; a bet with any market leg can never reach that (no resolution source
// for those), so it just stays open forever — deliberate, not a gap, same as before this existed.
export function settleBet(bet: PlacedBet, scores: LiveScoreEntry[]): BetOutcome | null {
  const results = computeLegResults(bet, scores);
  if (results.some((r) => r === "lost")) return { status: "lost", payout: 0 };
  if (results.length > 0 && results.every((r) => r === "won")) {
    const payout = bet.combined.marketProb > 0 ? bet.stake / bet.combined.marketProb : bet.stake;
    return { status: "won", payout };
  }
  return null;
}

// For the win-celebration flourish (app/page.tsx, app/lab/page.tsx): which real club a single-leg
// win was actually "on", collapsing a double-chance combo down to the one side it locks in — 1X
// can only ever mean the home team's celebration (its draw half has no club of its own to
// celebrate), X2 the away team's. A draw win has no club at all, so this returns null and the
// caller simply skips the celebration rather than fabricating one for a side that doesn't exist.
export function wonTeamName(leg: SlipLeg): string | null {
  if (leg.kind !== "sports") return null;
  if (leg.outcomeLabel === "1X") return leg.homeTeam ?? null;
  if (leg.outcomeLabel === "X2") return leg.awayTeam ?? null;
  if (leg.outcomeLabel === "Draw") return null;
  return leg.outcomeLabel;
}

// Which leagues are actually worth asking about: only ones with at least one leg that's still
// genuinely pending. A leg already cached won/lost (see computeLegResults) needs nothing further,
// so a parlay waiting on one last match never asks about the others it already knows the answer
// for, however many bets or leagues they originally spanned.
function settlementRefs(bets: PlacedBet[]): { league: LeagueId; earliestKickoff: string }[] {
  const earliestByLeague = new Map<LeagueId, string>();
  for (const bet of bets) {
    if (bet.settlement) continue;
    const cached = bet.legResults ?? [];
    backfilledLegs(bet).forEach((leg, i) => {
      if (leg.kind !== "sports" || !leg.league || !leg.startTime) return;
      if (cached[i] === "won" || cached[i] === "lost") return;
      const current = earliestByLeague.get(leg.league);
      if (!current || new Date(leg.startTime).getTime() < new Date(current).getTime()) {
        earliestByLeague.set(leg.league, leg.startTime);
      }
    });
  }
  return [...earliestByLeague.entries()].map(([league, earliestKickoff]) => ({ league, earliestKickoff }));
}

async function fetchScores(refs: { league: LeagueId; earliestKickoff: string }[]): Promise<LiveScoreEntry[]> {
  if (refs.length === 0) return [];
  try {
    const res = await fetch("/api/bets/settlement-scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.scores) ? data.scores : [];
  } catch {
    return [];
  }
}

export interface SettlementRun {
  bets: PlacedBet[];
  // Bets that transitioned from unsettled to Won in THIS call specifically — never a bet that was
  // already Won on a previous check, so a caller can use this to fire a one-time "you just won"
  // flourish without re-triggering it on every later page load.
  newlyWon: PlacedBet[];
}

// The whole algorithm, plainly: for every still-open bet, look up the real score of whichever of
// its matches haven't finished yet; if a leg's match is done, that leg is won or lost, for good —
// never recomputed again (see computeLegResults); once every leg is decided, the bet is too.
// Called every 60 seconds from Home and Lab while their tab is open (see SETTLEMENT_CHECK_INTERVAL_MS
// there) — best-effort throughout: a failed fetch just leaves those bets exactly as they were
// (still open), same as any other best-effort enrichment in this app, never inventing an outcome
// from missing data. The next check picks up wherever this one left off.
export async function resolvePendingSettlements(bets: PlacedBet[]): Promise<SettlementRun> {
  const refs = settlementRefs(bets);
  if (refs.length === 0) return { bets, newlyWon: [] };

  const scores = await fetchScores(refs);

  const settlementUpdates: Record<string, BetOutcome> = {};
  const legResultUpdates: Record<string, LegResult[]> = {};
  for (const bet of bets) {
    if (bet.settlement) continue;
    const results = computeLegResults(bet, scores);
    legResultUpdates[bet.id] = results;
    if (results.some((r) => r === "lost")) {
      settlementUpdates[bet.id] = { status: "lost", payout: 0 };
    } else if (results.length > 0 && results.every((r) => r === "won")) {
      const payout = bet.combined.marketProb > 0 ? bet.stake / bet.combined.marketProb : bet.stake;
      settlementUpdates[bet.id] = { status: "won", payout };
    }
  }

  let updated = bets;
  if (Object.keys(legResultUpdates).length > 0) updated = applyLegResults(legResultUpdates);
  if (Object.keys(settlementUpdates).length > 0) updated = applySettlements(settlementUpdates);

  const newlyWon = updated.filter((b) => settlementUpdates[b.id]?.status === "won");
  return { bets: updated, newlyWon };
}

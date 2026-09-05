import type { SlipLeg } from "./betslip";
import type { PlacedBet } from "./placedBets";
import { applySettlements, applyLegResults } from "./placedBets";
import type { LiveScoreEntry } from "./footballData";
import type { LeagueId } from "./types";
import { teamNamesMatch } from "./teamNameMatching";
import { leagueIdByName } from "./leagues";
import { fetchLivePrices, type LivePriceRequest } from "./livePrices";

export type LegResult = "won" | "lost" | "pending";

// A leg placed before it started carrying its own league/homeTeam/awayTeam/startTime would
// otherwise never be checked at all: settlementRefs and marketPriceRequests below both silently
// skip anything missing these, so a genuinely finished match's bet just sat as "Pending" forever
// with no way to ever notice it — that's the exact bug this fixes. Every leg has always carried
// `title` ("Home v Away", set once at leg-creation and never since changed) and `meta`
// ("🏴 League Name"), and every bet has always carried `placedAt` — recovered from those instead
// of needing the user to somehow fix data already sitting in their own browser storage.
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

// --- Market-based settlement (primary) --------------------------------------------------------
//
// How long after kickoff the match's own current market price is trusted as the real result,
// without ever needing football-data.org to confirm FINISHED — comfortably longer than any real
// match takes (~2h including stoppage/extra time) plus a 10-minute buffer for the market to
// finish digesting the result. This is what makes settlement fast: the football-data.org check
// further down still runs as a fallback (thin post-match liquidity, a missing token, an older leg
// that predates tokenIds), but most bets resolve here well before football-data.org would ever
// confirm FINISHED on its own slower, narrower-coverage schedule.
const MARKET_SETTLEMENT_GATE_MS = 130 * 60 * 1000;

function pastMarketGate(startTime: string | undefined): boolean {
  if (!startTime) return false;
  const t = new Date(startTime).getTime();
  return Number.isFinite(t) && Date.now() - t >= MARKET_SETTLEMENT_GATE_MS;
}

type Side = "home" | "draw" | "away";
const SIDES: Side[] = ["home", "draw", "away"];

export function marketOutcomeKey(pickId: string, side: Side): string {
  return `settlement-market:${pickId}:${side}`;
}

// Whichever of home/draw/away the match's OWN current price says is now most likely — however
// narrow the gap, not a "must clearly converge past some threshold" rule. A real market's price
// only has to lean toward the actual winner once the result is known; it never has to fully
// converge to 0/1 (thin post-match liquidity, or trading simply stopping once the outcome is
// obvious, can leave it well short of that) — requiring full convergence would leave exactly the
// bets this exists to unstick still stuck.
function marketImpliedWinner(prices: Partial<Record<Side, number>>): Side | null {
  const known = SIDES.filter((s) => Number.isFinite(prices[s]));
  if (known.length === 0) return null;
  return known.reduce((best, s) => ((prices[s] as number) > (prices[best] as number) ? s : best));
}

function outcomeMatchesSide(leg: SlipLeg, side: Side): boolean {
  if (leg.outcomeLabel === "1X") return side === "home" || side === "draw";
  if (leg.outcomeLabel === "X2") return side === "draw" || side === "away";
  if (leg.outcomeLabel === "Draw") return side === "draw";
  if (side === "home") return !!leg.homeTeam && teamNamesMatch(leg.outcomeLabel, leg.homeTeam);
  if (side === "away") return !!leg.awayTeam && teamNamesMatch(leg.outcomeLabel, leg.awayTeam);
  return false;
}

// Only ever attempted once pastMarketGate(leg.startTime) — before that, a mid-match or
// just-finished price hasn't had time to reflect the real result yet, so this stays "pending"
// rather than guessing from a number that's still moving.
export function legResultFromMarket(leg: SlipLeg, prices: Record<string, number>): LegResult {
  if (leg.kind !== "sports" || !leg.homeTeam || !leg.awayTeam || !pastMarketGate(leg.startTime)) return "pending";
  const winner = marketImpliedWinner({
    home: prices[marketOutcomeKey(leg.pickId, "home")],
    draw: prices[marketOutcomeKey(leg.pickId, "draw")],
    away: prices[marketOutcomeKey(leg.pickId, "away")],
  });
  if (!winner) return "pending";
  return outcomeMatchesSide(leg, winner) ? "won" : "lost";
}

// --- football-data.org-based settlement (fallback) --------------------------------------------

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

// The market read settles first (fast, no football-data.org dependency); the real final score is
// the fallback for whatever it can't resolve — thin post-match liquidity, a missing token, an
// older leg that predates tokenIds. Whichever source resolves first wins; if neither can, the leg
// stays open (never settled by guessing).
function combinedLegResult(leg: SlipLeg, scores: LiveScoreEntry[], marketPrices: Record<string, number>): LegResult {
  const fromMarket = legResultFromMarket(leg, marketPrices);
  if (fromMarket !== "pending") return fromMarket;
  return legResult(leg, scores);
}

export interface BetOutcome {
  status: "won" | "lost";
  payout: number;
}

// Per-leg results — independent of whether the WHOLE bet has settled, and exported so the "My
// Bets" list can color an individual leg green/red the moment ITS OWN match resolves, well before
// (or even instead of, if the bet ends up Lost) the parlay as a whole ever does.
export function computeLegResults(
  bet: PlacedBet,
  scores: LiveScoreEntry[],
  marketPrices: Record<string, number> = {}
): LegResult[] {
  return backfilledLegs(bet).map((leg) => combinedLegResult(leg, scores, marketPrices));
}

// A parlay settles LOST the moment any leg is confirmed lost, regardless of the others — no need
// to wait on a still-open leg once the bet can no longer possibly win. It only settles WON once
// EVERY leg is confirmed won; a bet with any market leg can never reach that (no resolution source
// for those), so it just stays open forever — deliberate, not a gap, same as before this existed.
export function settleBet(
  bet: PlacedBet,
  scores: LiveScoreEntry[],
  marketPrices: Record<string, number> = {}
): BetOutcome | null {
  const results = computeLegResults(bet, scores, marketPrices);
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

function settlementRefs(bets: PlacedBet[]): { league: LeagueId; earliestKickoff: string }[] {
  const earliestByLeague = new Map<LeagueId, string>();
  for (const bet of bets) {
    if (bet.settlement) continue;
    for (const leg of backfilledLegs(bet)) {
      if (leg.kind !== "sports" || !leg.league || !leg.startTime) continue;
      const current = earliestByLeague.get(leg.league);
      if (!current || new Date(leg.startTime).getTime() < new Date(current).getTime()) {
        earliestByLeague.set(leg.league, leg.startTime);
      }
    }
  }
  return [...earliestByLeague.entries()].map(([league, earliestKickoff]) => ({ league, earliestKickoff }));
}

// One request per distinct (match, side) still needed across every still-open bet — deduped by
// key so a parlay of several bets on the same match never asks twice. `fallback: NaN`, never a
// real number: a failed or incomplete fetch must never look like a real price, or settlement
// could compare a genuine number against a fabricated one and pick a "winner" out of thin air.
function marketPriceRequests(bets: PlacedBet[]): LivePriceRequest[] {
  const seen = new Set<string>();
  const requests: LivePriceRequest[] = [];
  for (const bet of bets) {
    if (bet.settlement) continue;
    for (const leg of backfilledLegs(bet)) {
      if (leg.kind !== "sports" || !leg.tokenIds || !pastMarketGate(leg.startTime)) continue;
      for (const side of SIDES) {
        const key = marketOutcomeKey(leg.pickId, side);
        if (seen.has(key)) continue;
        seen.add(key);
        const tokenId = leg.tokenIds[side];
        if (tokenId) requests.push({ key, tokenId, fallback: NaN });
      }
    }
  }
  return requests;
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

// Settles whatever it can — the market's own post-match read first, football-data.org's confirmed
// score as the fallback — persists it, and returns bets with settlement filled in. Best-effort
// throughout: a failed fetch on either side just leaves those bets exactly as they were (still
// open), same as any other best-effort enrichment in this app — never invents an outcome from
// missing data. Also persists per-leg results (computeLegResults) for every still-open bet, even
// ones that don't fully settle this round, so the UI can show an individual leg's own outcome
// ahead of (or instead of, if the parlay ends up Lost) the bet as a whole ever settling.
export async function resolvePendingSettlements(bets: PlacedBet[]): Promise<SettlementRun> {
  const refs = settlementRefs(bets);
  const priceRequests = marketPriceRequests(bets);
  if (refs.length === 0 && priceRequests.length === 0) return { bets, newlyWon: [] };

  const [scores, marketPrices] = await Promise.all([
    fetchScores(refs),
    priceRequests.length > 0 ? fetchLivePrices(priceRequests) : Promise.resolve({}),
  ]);

  const settlementUpdates: Record<string, BetOutcome> = {};
  const legResultUpdates: Record<string, LegResult[]> = {};
  for (const bet of bets) {
    if (bet.settlement) continue;
    const results = computeLegResults(bet, scores, marketPrices);
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

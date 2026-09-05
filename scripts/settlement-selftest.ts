import { legResult, settleBet } from "../lib/settlement";
import type { SlipLeg } from "../lib/betslip";
import type { PlacedBet } from "../lib/placedBets";
import type { LiveScoreEntry } from "../lib/footballData";

function sportsLeg(overrides: Partial<SlipLeg> = {}): SlipLeg {
  return {
    pickId: "p1",
    kind: "sports",
    title: "Arsenal v Chelsea",
    meta: "🏴 Premier League",
    outcomeLabel: "Arsenal",
    marketProb: 0.5,
    aiProb: 0.55,
    league: "premier-league",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    startTime: new Date().toISOString(),
    ...overrides,
  };
}

function marketLeg(overrides: Partial<SlipLeg> = {}): SlipLeg {
  return {
    pickId: "m1",
    kind: "market",
    title: "Will X happen?",
    meta: "💼 Business",
    outcomeLabel: "Yes",
    marketProb: 0.6,
    aiProb: 0.65,
    ...overrides,
  };
}

function score(overrides: Partial<LiveScoreEntry> = {}): LiveScoreEntry {
  return {
    league: "premier-league",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    status: "FINISHED",
    statusLabel: "Finished",
    homeGoals: 2,
    awayGoals: 1,
    ...overrides,
  };
}

function fakeBet(legs: SlipLeg[], marketProb: number, stake = 100): PlacedBet {
  return {
    id: "bet-1",
    placedAt: new Date().toISOString(),
    legs,
    combined: { marketProb, aiProb: marketProb, edge: 0 },
    stake,
  };
}

function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- legResult: per-outcome-label correctness against a real final score ---
  const homeWinScore = [score({ homeGoals: 2, awayGoals: 1 })];
  check("home team backed, home won -> won", legResult(sportsLeg({ outcomeLabel: "Arsenal" }), homeWinScore) === "won");
  check("away team backed, home won -> lost", legResult(sportsLeg({ outcomeLabel: "Chelsea" }), homeWinScore) === "lost");
  check("draw backed, home won -> lost", legResult(sportsLeg({ outcomeLabel: "Draw" }), homeWinScore) === "lost");
  check("1X backed, home won -> won", legResult(sportsLeg({ outcomeLabel: "1X" }), homeWinScore) === "won");
  check("X2 backed, home won -> lost", legResult(sportsLeg({ outcomeLabel: "X2" }), homeWinScore) === "lost");

  const drawScore = [score({ homeGoals: 1, awayGoals: 1 })];
  check("draw backed, actual draw -> won", legResult(sportsLeg({ outcomeLabel: "Draw" }), drawScore) === "won");
  check("1X backed, actual draw -> won", legResult(sportsLeg({ outcomeLabel: "1X" }), drawScore) === "won");
  check("X2 backed, actual draw -> won", legResult(sportsLeg({ outcomeLabel: "X2" }), drawScore) === "won");
  check("home backed, actual draw -> lost", legResult(sportsLeg({ outcomeLabel: "Arsenal" }), drawScore) === "lost");

  // --- pending cases: never guess without real, final data ---
  check("no matching score at all -> pending", legResult(sportsLeg(), []) === "pending");
  check(
    "match found but not yet finished -> pending",
    legResult(sportsLeg(), [score({ status: "IN_PLAY", homeGoals: 1, awayGoals: 0 })]) === "pending"
  );
  check(
    "a market (Discover) leg is always pending, even with matching-looking scores present",
    legResult(marketLeg(), homeWinScore) === "pending"
  );
  check(
    "an older leg missing league/homeTeam/awayTeam is pending, never guessed",
    legResult(sportsLeg({ league: undefined, homeTeam: undefined, awayTeam: undefined }), homeWinScore) === "pending"
  );
  check(
    "team name fuzzy-matches (Newcastle vs Newcastle United) still resolve",
    legResult(sportsLeg({ homeTeam: "Newcastle United", outcomeLabel: "Newcastle United" }), [
      score({ homeTeam: "Newcastle", homeGoals: 3, awayGoals: 0 }),
    ]) === "won"
  );

  // --- settleBet: parlay-level rules ---
  const singleWon = fakeBet([sportsLeg({ outcomeLabel: "Arsenal" })], 0.5);
  const wonOutcome = settleBet(singleWon, homeWinScore);
  check("a single winning leg settles WON", wonOutcome?.status === "won");
  check("WON payout is stake / combined marketProb (decimal odds)", wonOutcome?.payout === 200);

  const singleLost = fakeBet([sportsLeg({ outcomeLabel: "Chelsea" })], 0.5);
  check("a single losing leg settles LOST with zero payout", settleBet(singleLost, homeWinScore)?.status === "lost");
  check("LOST payout is exactly zero", settleBet(singleLost, homeWinScore)?.payout === 0);

  const parlayOneLegLoses = fakeBet(
    [
      sportsLeg({ pickId: "p1", outcomeLabel: "Arsenal" }),
      sportsLeg({ pickId: "p2", outcomeLabel: "Liverpool", homeTeam: "Liverpool", awayTeam: "Everton" }),
    ],
    0.3
  );
  const mixedScores = [homeWinScore[0], score({ homeTeam: "Liverpool", awayTeam: "Everton", homeGoals: 1, awayGoals: 1 })];
  check(
    "a parlay settles LOST the instant any leg is confirmed lost, even if another leg also lost",
    settleBet(parlayOneLegLoses, mixedScores)?.status === "lost"
  );

  const parlayAllWin = fakeBet(
    [sportsLeg({ pickId: "p1", outcomeLabel: "Arsenal" }), sportsLeg({ pickId: "p2", outcomeLabel: "Liverpool", homeTeam: "Liverpool", awayTeam: "Everton" })],
    0.25
  );
  const allWinScores = [homeWinScore[0], score({ homeTeam: "Liverpool", awayTeam: "Everton", homeGoals: 2, awayGoals: 0 })];
  check("a parlay settles WON only once every leg is confirmed won", settleBet(parlayAllWin, allWinScores)?.status === "won");

  const parlayStillOpen = fakeBet(
    [sportsLeg({ pickId: "p1", outcomeLabel: "Arsenal" }), sportsLeg({ pickId: "p2", outcomeLabel: "Liverpool", homeTeam: "Liverpool", awayTeam: "Everton" })],
    0.25
  );
  check(
    "a parlay with one leg still pending (not lost) stays open, not settled either way",
    settleBet(parlayStillOpen, [homeWinScore[0]]) === null
  );

  const mixedWithMarketLeg = fakeBet([sportsLeg({ outcomeLabel: "Arsenal" }), marketLeg()], 0.3);
  check(
    "a bet mixing a won football leg with a market leg can never settle WON (market legs never confirm)",
    settleBet(mixedWithMarketLeg, homeWinScore) === null
  );

  const mixedMarketLegLoses = fakeBet([sportsLeg({ outcomeLabel: "Chelsea" }), marketLeg()], 0.3);
  check(
    "a bet mixing a lost football leg with a market leg still settles LOST",
    settleBet(mixedMarketLegLoses, homeWinScore)?.status === "lost"
  );

  const noSportsLegsAtAll = fakeBet([marketLeg()], 0.6);
  check("a pure-market bet with zero football legs never settles", settleBet(noSportsLegsAtAll, homeWinScore) === null);

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll settlement cases passed.");
}

run();

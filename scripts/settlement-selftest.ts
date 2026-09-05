import { legResult, settleBet, computeLegResults, wonTeamName } from "../lib/settlement";
import type { SlipLeg } from "../lib/betslip";
import type { PlacedBet } from "../lib/placedBets";
import type { LiveScoreEntry } from "../lib/liveScores";

const HOUR = 60 * 60 * 1000;

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

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
  // A club Polymarket only ever names by its short form. football-data.org's full name doesn't
  // match it at all, so before short names were carried through, a bet on one of these clubs
  // simply never found its own result and sat unsettled forever however long ago it finished.
  check(
    "a club known only by its short name (Wolves) still settles",
    legResult(
      sportsLeg({ homeTeam: "Wolves", awayTeam: "Spurs", outcomeLabel: "Wolves" }),
      [
        score({
          homeTeam: "Wolverhampton Wanderers FC",
          homeTeamShort: "Wolves",
          awayTeam: "Tottenham Hotspur FC",
          awayTeamShort: "Spurs",
          homeGoals: 2,
          awayGoals: 1,
        }),
      ]
    ) === "won"
  );
  check(
    "the same short-name match resolves a LOST bet correctly too, not just a won one",
    legResult(
      sportsLeg({ homeTeam: "Wolves", awayTeam: "Spurs", outcomeLabel: "Spurs" }),
      [
        score({
          homeTeam: "Wolverhampton Wanderers FC",
          homeTeamShort: "Wolves",
          awayTeam: "Tottenham Hotspur FC",
          awayTeamShort: "Spurs",
          homeGoals: 2,
          awayGoals: 1,
        }),
      ]
    ) === "lost"
  );
  check(
    "team name fuzzy-matches (Newcastle vs Newcastle United) still resolve",
    legResult(sportsLeg({ homeTeam: "Newcastle United", outcomeLabel: "Newcastle United" }), [
      score({ homeTeam: "Newcastle", homeGoals: 3, awayGoals: 0 }),
    ]) === "won"
  );

  // --- settleBet: a leg placed before it carried league/homeTeam/awayTeam/startTime/tokenIds at
  // all (the exact reported bug: a bet placed days ago, its match long finished, stuck on
  // "Pending" forever) still settles — recovered from title ("Home v Away"), meta
  // ("🏴 League Name"), and the bet's own placedAt, none of which have ever been optional. ---
  {
    const ancientLeg: SlipLeg = {
      pickId: "p9",
      kind: "sports",
      title: "Arsenal v Chelsea",
      meta: "🏴 Premier League",
      outcomeLabel: "Arsenal",
      marketProb: 0.5,
      aiProb: 0.55,
      // No league, homeTeam, awayTeam, startTime, or tokenIds — exactly what a leg saved before
      // any of this existed looks like.
    };
    const bet: PlacedBet = {
      id: "bet-ancient",
      placedAt: isoAgo(2 * 24 * HOUR),
      legs: [ancientLeg],
      combined: { marketProb: 0.5, aiProb: 0.55, edge: 0.05 },
      stake: 100,
    };
    const outcome = settleBet(bet, homeWinScore);
    check("a leg with none of the settlement-only fields still settles via the real score", outcome?.status === "won");
    check("its payout is still computed correctly", outcome?.payout === 200);
  }
  {
    // Same shape, but the actual result means it lost — still resolves, not just "won by default".
    const ancientLosingLeg: SlipLeg = {
      pickId: "p10",
      kind: "sports",
      title: "Arsenal v Chelsea",
      meta: "🏴 Premier League",
      outcomeLabel: "Chelsea",
      marketProb: 0.3,
      aiProb: 0.35,
    };
    const bet: PlacedBet = {
      id: "bet-ancient-lost",
      placedAt: isoAgo(2 * 24 * HOUR),
      legs: [ancientLosingLeg],
      combined: { marketProb: 0.3, aiProb: 0.35, edge: 0.05 },
      stake: 100,
    };
    check("the same backfill correctly settles LOST too, not just WON", settleBet(bet, homeWinScore)?.status === "lost");
  }

  // --- computeLegResults: per-leg results independent of whether the whole bet settles — a
  // 3-leg parlay where one match already lost still shows its OTHER legs' own individual state,
  // not just the parlay-level "Lost" collapse. ---
  {
    const parlay = fakeBet(
      [
        sportsLeg({ pickId: "p1", outcomeLabel: "Arsenal" }), // wins
        sportsLeg({ pickId: "p2", outcomeLabel: "Liverpool", homeTeam: "Liverpool", awayTeam: "Everton" }), // loses
        sportsLeg({ pickId: "p3", outcomeLabel: "Real Madrid", homeTeam: "Real Madrid", awayTeam: "Barcelona" }), // not started
      ],
      0.15
    );
    const scores = [
      homeWinScore[0],
      score({ homeTeam: "Liverpool", awayTeam: "Everton", homeGoals: 1, awayGoals: 2 }),
    ];
    const results = computeLegResults(parlay, scores);
    check(
      "each leg reports its own individual result, not the parlay's collapsed outcome",
      JSON.stringify(results) === JSON.stringify(["won", "lost", "pending"]),
      JSON.stringify(results)
    );
  }

  // --- computeLegResults: a leg already resolved won/lost is cached, never recomputed — the exact
  // "check every minute and cache the settled ones" behavior. Proven by handing it a fresh score
  // that says the OPPOSITE of the cached result and confirming the cached one still wins: once a
  // leg is decided, nothing fetched afterward can flip it. ---
  {
    const bet: PlacedBet = {
      ...fakeBet(
        [
          sportsLeg({ pickId: "p1", outcomeLabel: "Arsenal" }), // cached as already won
          sportsLeg({ pickId: "p2", outcomeLabel: "Liverpool", homeTeam: "Liverpool", awayTeam: "Everton" }), // still pending
        ],
        0.2
      ),
      legResults: ["won", "pending"],
    };
    // A contradicting score for leg 1 (Chelsea actually won) plus the real answer for leg 2.
    const freshScores = [
      score({ homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 0, awayGoals: 3 }),
      score({ homeTeam: "Liverpool", awayTeam: "Everton", homeGoals: 2, awayGoals: 0 }),
    ];
    const results = computeLegResults(bet, freshScores);
    check(
      "a leg already cached as won stays won even when the fresh score disagrees",
      results[0] === "won",
      JSON.stringify(results)
    );
    check("a still-pending leg is freshly resolved from the real score", results[1] === "won", JSON.stringify(results));
  }
  check(
    "a leg with no prior legResults at all is resolved fresh, same as always",
    computeLegResults(fakeBet([sportsLeg({ outcomeLabel: "Arsenal" })], 0.5), homeWinScore)[0] === "won"
  );

  // --- wonTeamName: which real club a single-leg win was actually "on", for the win-celebration
  // flourish — 1X/X2 collapse to the one side they lock in, a market leg or a draw have no club. ---
  check("a home-team bet resolves to the home team itself", wonTeamName(sportsLeg({ outcomeLabel: "Arsenal" })) === "Arsenal");
  check("an away-team bet resolves to the away team itself", wonTeamName(sportsLeg({ outcomeLabel: "Chelsea" })) === "Chelsea");
  check("a 1X bet resolves to the home team (its draw half has no club)", wonTeamName(sportsLeg({ outcomeLabel: "1X" })) === "Arsenal");
  check("an X2 bet resolves to the away team", wonTeamName(sportsLeg({ outcomeLabel: "X2" })) === "Chelsea");
  check("a draw bet has no club to celebrate", wonTeamName(sportsLeg({ outcomeLabel: "Draw" })) === null);
  check("a market (Discover) leg has no club either", wonTeamName(marketLeg()) === null);

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

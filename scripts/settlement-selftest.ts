import { legResult, legResultFromMarket, settleBet, marketOutcomeKey, computeLegResults, wonTeamName } from "../lib/settlement";
import type { SlipLeg } from "../lib/betslip";
import type { PlacedBet } from "../lib/placedBets";
import type { LiveScoreEntry } from "../lib/footballData";
import { MATCH_OVER_AFTER_MS } from "../lib/matchClock";

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

// A leg whose match is comfortably over (lib/matchClock.ts's MATCH_OVER_AFTER_MS), carrying all
// three outcome tokens — the shape legResultFromMarket actually needs.
function pastGateLeg(overrides: Partial<SlipLeg> = {}): SlipLeg {
  return sportsLeg({
    startTime: isoAgo(MATCH_OVER_AFTER_MS + HOUR),
    tokenIds: { home: "tok-home", draw: "tok-draw", away: "tok-away" },
    ...overrides,
  });
}

function marketPrices(pickId: string, home: number, draw: number, away: number): Record<string, number> {
  return {
    [marketOutcomeKey(pickId, "home")]: home,
    [marketOutcomeKey(pickId, "draw")]: draw,
    [marketOutcomeKey(pickId, "away")]: away,
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

  // --- legResultFromMarket: settle on whichever side the match's own current price says won ---
  {
    const homeClearlyWon = marketPrices("p1", 0.95, 0.03, 0.02);
    check(
      "home backed, market heavily favors home -> won",
      legResultFromMarket(pastGateLeg({ outcomeLabel: "Arsenal" }), homeClearlyWon) === "won"
    );
    check(
      "away backed, market heavily favors home -> lost",
      legResultFromMarket(pastGateLeg({ outcomeLabel: "Chelsea" }), homeClearlyWon) === "lost"
    );
    check(
      "1X backed, market heavily favors home -> won",
      legResultFromMarket(pastGateLeg({ outcomeLabel: "1X" }), homeClearlyWon) === "won"
    );
    check(
      "X2 backed, market heavily favors home -> lost",
      legResultFromMarket(pastGateLeg({ outcomeLabel: "X2" }), homeClearlyWon) === "lost"
    );
  }
  check(
    "settles on whichever side is highest even without full convergence (thin post-match liquidity)",
    legResultFromMarket(pastGateLeg({ outcomeLabel: "Arsenal" }), marketPrices("p1", 0.52, 0.28, 0.2)) === "won"
  );
  check(
    "before the time gate, market data is ignored entirely -> pending, even with a clear price",
    legResultFromMarket(sportsLeg({ outcomeLabel: "Arsenal", tokenIds: { home: "h", draw: "d", away: "a" } }), marketPrices("p1", 0.97, 0.02, 0.01)) === "pending"
  );
  // A match still running long (VAR, injuries, a delayed restart) is priced like the side that's
  // currently ahead — settling off that would call a bet the 85th minute's way, not the result's.
  // The gate is the app's one "this match is definitely over" line, nothing shorter.
  check(
    "a match 2h20m in is still not settled from the market, however lopsided the price",
    legResultFromMarket(
      sportsLeg({ outcomeLabel: "Arsenal", startTime: isoAgo(2 * HOUR + 20 * 60 * 1000), tokenIds: { home: "h", draw: "d", away: "a" } }),
      marketPrices("p1", 0.97, 0.02, 0.01)
    ) === "pending"
  );
  check(
    "no price data at all for this match -> pending, never guessed",
    legResultFromMarket(pastGateLeg(), {}) === "pending"
  );
  check(
    "a market (Discover) leg is always pending here too, even past any time gate",
    legResultFromMarket({ ...marketLeg(), startTime: isoAgo(3 * HOUR) }, marketPrices("m1", 0.97, 0.02, 0.01)) === "pending"
  );

  // --- settleBet: the market read resolves FIRST, before football-data.org is even consulted —
  // demonstrated by giving it a score that would say the opposite and confirming the market wins ---
  {
    const contradictingScore = [score({ homeGoals: 0, awayGoals: 3 })]; // Chelsea won on the scoreboard...
    const marketSaysHomeWon = marketPrices("p1", 0.96, 0.02, 0.02); // ...but the market says Arsenal.
    const bet = fakeBet([pastGateLeg({ outcomeLabel: "Arsenal" })], 0.5);
    const outcome = settleBet(bet, contradictingScore, marketSaysHomeWon);
    check("the market read settles the bet before football-data.org's score is even used", outcome?.status === "won");
  }

  // --- settleBet: falls back to football-data.org's real score when no market data is available
  // (no tokenIds, or still before the time gate) — the two paths compose, not compete ---
  {
    const betNoTokens = fakeBet([sportsLeg({ outcomeLabel: "Arsenal", startTime: isoAgo(3 * HOUR) })], 0.5);
    const outcome = settleBet(betNoTokens, homeWinScore, marketPrices("p1", 0.5, 0.3, 0.2));
    check(
      "a leg with no tokenIds falls back to the real score even with market prices available for other legs",
      outcome?.status === "won"
    );
  }

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

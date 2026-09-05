import { mergeGames } from "../lib/gamesCache";
import { MATCH_OVER_AFTER_MS } from "../lib/matchClock";
import type { Game } from "../lib/types";

function fakeGame(id: string, startTime: string): Game {
  return {
    id,
    slug: id,
    league: "premier-league",
    leagueName: "Premier League",
    leagueFlag: "🏴",
    homeTeam: `Home${id}`,
    awayTeam: `Away${id}`,
    startTime,
    odds: { home: 0.4, draw: 0.3, away: 0.3 },
    volume: 0,
    liquidity: 0,
    polymarketUrl: `https://polymarket.com/event/${id}`,
  };
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function isoFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

const HOUR = 60 * 60 * 1000;

function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // The exact reported bug: a match already underway drops out of a fresh fetch (Polymarket closes
  // its market within hours of kickoff, long before the match itself is done) — it must survive
  // the merge rather than vanishing off the list mid-game.
  const inProgress = fakeGame("g1", isoAgo(2 * HOUR));
  const stillThere = fakeGame("g2", isoAgo(HOUR));
  const merged1 = mergeGames([inProgress, stillThere], [stillThere]);
  check("a match still in progress survives a fresh fetch that dropped it", merged1.some((g) => g.id === "g1"));
  check("a game still present in the fresh fetch is unaffected", merged1.some((g) => g.id === "g2"));

  // A match that's already over isn't carried any further — the Sports page hides those anyway, so
  // keeping them alive in the merge would just be work nothing consumes.
  const longGone = fakeGame("g3", isoAgo(MATCH_OVER_AFTER_MS + HOUR));
  const merged2 = mergeGames([longGone], []);
  check("a match that's already over is not kept", merged2.length === 0);

  // A future game missing from a fresh fetch is a real removal (delisted, filters changed), not
  // the "closed right after kickoff" case — it must NOT be preserved.
  const upcoming = fakeGame("g4", isoFromNow(2 * HOUR));
  const merged3 = mergeGames([upcoming], []);
  check("a future game missing from a fresh fetch is not preserved", merged3.length === 0);

  // Fresh data always wins for a game it still contains, even if the previous copy differs (e.g.
  // updated odds) — no stale duplicate should linger alongside it.
  const staleOdds = { ...fakeGame("g5", isoAgo(HOUR)), odds: { home: 0.1, draw: 0.1, away: 0.8 } };
  const freshOdds = fakeGame("g5", isoAgo(HOUR));
  const merged4 = mergeGames([staleOdds], [freshOdds]);
  check("fresh data replaces the previous copy of a game present in both", merged4.length === 1 && merged4[0].odds.home === 0.4);

  // A live game's own odds are exempt from the fresh-wins rule: the dedicated live-odds poll owns
  // that field once a match has kicked off, so a general sweep landing moments later must not
  // overwrite it with a less current snapshot — the exact "manual refresh doesn't affect live
  // games" requirement.
  {
    const stalePrevious = { ...fakeGame("g8", isoAgo(HOUR)), odds: { home: 0.7, draw: 0.2, away: 0.1 }, volume: 100 };
    const freshSweep = { ...fakeGame("g8", isoAgo(HOUR)), odds: { home: 0.3, draw: 0.3, away: 0.4 }, volume: 250 };
    const merged = mergeGames([stalePrevious], [freshSweep], new Set(["g8"]));
    check(
      "a live game's odds are kept from the previous copy, not overwritten by a general sweep",
      merged.length === 1 && merged[0].odds.home === 0.7,
      `${JSON.stringify(merged[0]?.odds)}`
    );
    check(
      "everything else about a live game still updates from the fresh fetch",
      merged[0].volume === freshSweep.volume,
      String(merged[0]?.volume)
    );
  }
  {
    // The same game, NOT marked live this time — the ordinary fresh-wins rule applies as normal.
    const stalePrevious = { ...fakeGame("g9", isoAgo(HOUR)), odds: { home: 0.7, draw: 0.2, away: 0.1 } };
    const freshSweep = { ...fakeGame("g9", isoAgo(HOUR)), odds: { home: 0.3, draw: 0.3, away: 0.4 } };
    const merged = mergeGames([stalePrevious], [freshSweep], new Set());
    check(
      "a game not marked live still takes its odds from the fresh fetch as usual",
      merged[0].odds.home === 0.3,
      String(merged[0]?.odds.home)
    );
  }
  {
    // A game marked live but with no previous copy at all (first time seen) — nothing to preserve,
    // so it just takes the fresh snapshot, same as any other new game.
    const freshOnly = fakeGame("g10", isoAgo(HOUR));
    const merged = mergeGames([], [freshOnly], new Set(["g10"]));
    check(
      "a newly-seen live game with no prior copy just uses the fresh snapshot",
      merged.length === 1 && merged[0].odds.home === 0.4
    );
  }

  // Result stays sorted by kickoff time even when survivors are appended after fresh games.
  const early = fakeGame("g6", isoAgo(2 * HOUR));
  const late = fakeGame("g7", isoAgo(HOUR));
  const merged5 = mergeGames([early], [late]);
  check(
    "merged result stays sorted by startTime",
    merged5.map((g) => g.id).join(",") === "g6,g7"
  );

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll gamesCache merge cases passed.");
}

run();

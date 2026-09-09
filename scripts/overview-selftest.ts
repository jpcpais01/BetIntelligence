import { computeOverview } from "../lib/overview";
import type { LastAnalysisEntry } from "../lib/lastAnalysis";
import type { IndependentPrediction, Probabilities, LeagueId } from "../lib/types";
import type { LiveScoreEntry } from "../lib/liveScores";

// A fixed "now" close to every fixture's default startTime — computeOverview only looks back
// MAX_SETTLEMENT_LOOKBACK_MS (10 days, lib/liveScores.ts) from `now`, so leaving this to the real
// wall clock would silently drop every fixture below as "too old to check" the moment this file's
// hardcoded 2026-01-01 dates age out of that window.
const NOW = new Date("2026-01-02T12:00:00.000Z").getTime();

function independentOf(home: number, draw: number, away: number): IndependentPrediction {
  return { home, draw, away, confidence: "medium", homeAssessment: { pros: [], cons: [] }, awayAssessment: { pros: [], cons: [] }, summary: "" };
}

function entry(opts: {
  market: Probabilities;
  independent: IndependentPrediction;
  bestValue: "home" | "draw" | "away" | "none";
  edges?: Probabilities;
  homeTeam?: string;
  awayTeam?: string;
  league?: LeagueId;
  startTime?: string;
}): LastAnalysisEntry {
  const edges = opts.edges ?? {
    home: opts.independent.home - opts.market.home,
    draw: opts.independent.draw - opts.market.draw,
    away: opts.independent.away - opts.market.away,
  };
  return {
    analyzedAt: new Date().toISOString(),
    market: opts.market,
    independent: opts.independent,
    comparison: { edges, bestValue: opts.bestValue, confidence: "medium", agreesWithMarket: false, verdict: "" },
    league: opts.league ?? "premier-league",
    leagueName: "Premier League",
    leagueFlag: "🏴",
    homeTeam: opts.homeTeam ?? "Home",
    awayTeam: opts.awayTeam ?? "Away",
    startTime: opts.startTime ?? "2026-01-01T15:00:00.000Z",
  };
}

function score(opts: { league: LeagueId; homeTeam: string; awayTeam: string; homeGoals: number; awayGoals: number }): LiveScoreEntry {
  return {
    league: opts.league,
    homeTeam: opts.homeTeam,
    awayTeam: opts.awayTeam,
    status: "FINISHED",
    statusLabel: "Finished",
    homeGoals: opts.homeGoals,
    awayGoals: opts.awayGoals,
  };
}

function mockFetch(scores: LiveScoreEntry[]) {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ scores }),
  })) as unknown as typeof fetch;
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- A single resolved straight win: Home is a 55% favorite with a 15pp edge (Calm), the match
  // finished with Home actually winning. Also has a combo leg (1X, since it covers the same lean)
  // — the combo can never be Calm (favorite-only), so it should land somewhere else even though
  // it's the same underlying game. ---
  {
    mockFetch([score({ league: "premier-league", homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 2, awayGoals: 0 })]);
    const analyses = {
      g1: entry({
        market: { home: 0.55, draw: 0.25, away: 0.2 },
        independent: independentOf(0.7, 0.18, 0.12),
        bestValue: "home",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
      }),
    };
    const result = await computeOverview(analyses, NOW);
    const calmStraight = result.cells.find((c) => c.mode === "calm" && c.strategy === "straight")!;
    check("a 15pp favorite edge that won lands in Calm/straight with a score > 1", calmStraight.resolvedCount === 1 && calmStraight.score !== null && calmStraight.score > 1, JSON.stringify(calmStraight));
    check("Calm/combo has nothing — combos can never be Calm", result.cells.find((c) => c.mode === "calm" && c.strategy === "combo")!.resolvedCount === 0);
    check("totalAnalyzed counts the one distinct game", result.totalAnalyzed === 1);
    check("totalResolved counts both the straight and combo leg", result.totalResolved === 2, String(result.totalResolved));
  }

  // --- bestValue "none" excludes the straight leg entirely, but the combo leg is still built
  // independently — a combo can have real edge even when no single side clears the model's own
  // ~5pp bar for flagging a straight recommendation. ---
  {
    mockFetch([]);
    const analyses = {
      g2: entry({
        market: { home: 0.34, draw: 0.33, away: 0.33 },
        independent: independentOf(0.5, 0.3, 0.2), // home+draw edge = 0.8-0.67 = 13pp, real combo edge
        bestValue: "none",
        homeTeam: "Fulham",
        awayTeam: "Brentford",
      }),
    };
    const result = await computeOverview(analyses, NOW);
    const totalHypotheticals = result.cells.reduce((n, c) => n + c.resolvedCount + c.pendingCount, 0);
    check("bestValue 'none' excludes the straight leg but the combo leg still exists", totalHypotheticals === 1, String(totalHypotheticals));
  }

  // --- An entry missing match identity (predates that field) is skipped entirely, never guessed. ---
  {
    mockFetch([]);
    const analyses: Record<string, LastAnalysisEntry> = {
      g3: {
        analyzedAt: new Date().toISOString(),
        market: { home: 0.5, draw: 0.3, away: 0.2 },
        independent: independentOf(0.65, 0.2, 0.15),
        comparison: { edges: { home: 0.15, draw: 0, away: 0 }, bestValue: "home", confidence: "medium", agreesWithMarket: false, verdict: "" },
        // no league/homeTeam/awayTeam/startTime — predates the field
      },
    };
    const result = await computeOverview(analyses, NOW);
    check("an entry with no match identity contributes nothing", result.totalAnalyzed === 0 && result.totalResolved === 0 && result.totalPending === 0);
  }

  // --- Favorite gating: the SAME 15pp edge on a genuine underdog never lands in Calm — it falls to
  // Normal, same as the rest of the app's classification (lib/riskModes.ts's riskModeFor). ---
  {
    mockFetch([]);
    const analyses = {
      g4: entry({
        market: { home: 0.3, draw: 0.27, away: 0.43 }, // away is the true favorite
        independent: independentOf(0.45, 0.25, 0.3), // home edge = 15pp, but home isn't the favorite
        bestValue: "home",
        homeTeam: "Everton",
        awayTeam: "Newcastle",
      }),
    };
    const result = await computeOverview(analyses, NOW);
    const calmStraight = result.cells.find((c) => c.mode === "calm" && c.strategy === "straight")!;
    const normalStraight = result.cells.find((c) => c.mode === "normal" && c.strategy === "straight")!;
    check("a 15pp edge on a non-favorite never lands in Calm", calmStraight.resolvedCount + calmStraight.pendingCount === 0);
    check("...it lands in Normal instead", normalStraight.resolvedCount + normalStraight.pendingCount === 1);
  }

  // --- No score data at all (fetch fails/empty) — everything shows as pending, never a guessed
  // result, and the score stays null rather than a fabricated number. ---
  {
    mockFetch([]);
    const analyses = {
      g5: entry({
        market: { home: 0.5, draw: 0.3, away: 0.2 },
        independent: independentOf(0.65, 0.2, 0.15),
        bestValue: "home",
        homeTeam: "Wolves",
        awayTeam: "Brighton",
      }),
    };
    const result = await computeOverview(analyses, NOW);
    check("every cell's score is null with no resolved data anywhere", result.cells.every((c) => c.score === null));
    check("overallScore is null too — no data, not a fabricated break-even", result.overallScore === null);
    check("everything shows as pending, not silently dropped", result.totalPending === 2 && result.totalResolved === 0);
  }

  // --- A loss counts toward its own tier too (the whole point of a hypothetical-record page) —
  // and combines across multiple games into one combined overallScore. ---
  {
    mockFetch([
      score({ league: "premier-league", homeTeam: "Villa", awayTeam: "Palace", homeGoals: 0, awayGoals: 1 }), // g6: home lost
      score({ league: "premier-league", homeTeam: "Luton", awayTeam: "Burnley", homeGoals: 2, awayGoals: 2 }), // g7: draw
    ]);
    const analyses = {
      g6: entry({
        market: { home: 0.6, draw: 0.25, away: 0.15 },
        independent: independentOf(0.75, 0.15, 0.1), // 15pp favorite edge on home, but home LOSES
        bestValue: "home",
        homeTeam: "Villa",
        awayTeam: "Palace",
      }),
      g7: entry({
        market: { home: 0.35, draw: 0.3, away: 0.35 },
        independent: independentOf(0.2, 0.5, 0.3), // draw edge = 20pp, draw is not "the favorite" here (tie at 0.35)... favorite is either home or away
        bestValue: "draw",
        homeTeam: "Luton",
        awayTeam: "Burnley",
      }),
    };
    const result = await computeOverview(analyses, NOW);
    check("a losing favorite still counts toward Calm, dragging its score under 1", (() => {
      const calm = result.cells.find((c) => c.mode === "calm" && c.strategy === "straight")!;
      return calm.resolvedCount >= 1 && calm.score !== null && calm.score < 1;
    })(), JSON.stringify(result.cells.find((c) => c.mode === "calm" && c.strategy === "straight")));
    check("overallScore combines every resolved leg across every game and tier", result.overallScore !== null);
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll overview cases passed.");
}

run();

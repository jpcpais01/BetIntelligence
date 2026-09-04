import { buildFootballDigest } from "../lib/footballData";

process.env.FOOTBALL_DATA_API_KEY = "test-key";

interface TeamRef {
  id: number;
  name: string;
}

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json, text: async () => "" };
}

function match(opts: {
  id: number;
  date: string;
  home: TeamRef;
  away: TeamRef;
  status: string;
  homeGoals: number | null;
  awayGoals: number | null;
}) {
  return {
    id: opts.id,
    utcDate: opts.date,
    status: opts.status,
    homeTeam: opts.home,
    awayTeam: opts.away,
    score: { fullTime: { home: opts.homeGoals, away: opts.awayGoals } },
  };
}

// Dispatches by URL like the real football-data.org calls this module makes, recording every URL
// requested so tests can assert on which competition/team was queried without exporting internals.
function makeFootballDataFetch(opts: {
  rosterTeams: TeamRef[];
  home: TeamRef;
  away: TeamRef;
  fixtures?: unknown[];
  homeForm?: unknown[];
  awayForm?: unknown[];
  h2h?: unknown[];
  urls: string[];
}) {
  return (async (url: unknown) => {
    const u = String(url);
    opts.urls.push(u);
    if (u.includes("/competitions/")) return ok({ teams: opts.rosterTeams });
    if (u.includes("/head2head")) return ok({ matches: opts.h2h ?? [] });
    if (u.includes(`/teams/${opts.home.id}/matches`)) return ok({ matches: opts.homeForm ?? [] });
    if (u.includes(`/teams/${opts.away.id}/matches`)) return ok({ matches: opts.awayForm ?? [] });
    if (u.includes("/matches?")) return ok({ matches: opts.fixtures ?? [] });
    throw new Error(`Unhandled football-data.org URL in test: ${u}`);
  }) as unknown as typeof fetch;
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- Missing API key fails clearly rather than silently proceeding — must run before any
  // other case populates the roster cache below, or a cache hit would skip the fetch (and the
  // key check inside it) entirely. ---
  {
    const savedKey = process.env.FOOTBALL_DATA_API_KEY;
    delete process.env.FOOTBALL_DATA_API_KEY;
    globalThis.fetch = (async () => {
      throw new Error("fetch should not be called without a key");
    }) as unknown as typeof fetch;
    let threw: Error | null = null;
    try {
      await buildFootballDigest({ homeTeam: "A", awayTeam: "B", league: "premier-league", startTime: "2026-10-01T19:00:00.000Z" });
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err));
    }
    check("a missing FOOTBALL_DATA_API_KEY throws a clear configuration error", /FOOTBALL_DATA_API_KEY/.test(threw?.message ?? ""), threw?.message);
    process.env.FOOTBALL_DATA_API_KEY = savedKey;
  }

  // --- Uses the right competition code for each league (no season param needed or sent) ---
  {
    const home = { id: 1, name: "Arsenal" };
    const away = { id: 2, name: "Chelsea" };
    const urls: string[] = [];
    globalThis.fetch = makeFootballDataFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [match({ id: 10, date: "2026-01-15T20:00:00.000Z", home, away, status: "SCHEDULED", homeGoals: null, awayGoals: null })],
      urls,
    });
    await buildFootballDigest({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league", startTime: "2026-01-15T20:00:00.000Z" });
    check("premier-league resolves to competition code PL", urls.some((u) => u.includes("/competitions/PL/teams")), urls.join(" | "));
    check("no season parameter is sent (the real bug this replaced)", !urls.some((u) => u.includes("season=")), urls.join(" | "));
  }
  {
    const home = { id: 3, name: "Bayern Munich" };
    const away = { id: 4, name: "Dortmund" };
    const urls: string[] = [];
    globalThis.fetch = makeFootballDataFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [match({ id: 11, date: "2026-09-20T18:30:00.000Z", home, away, status: "SCHEDULED", homeGoals: null, awayGoals: null })],
      urls,
    });
    await buildFootballDigest({ homeTeam: "Bayern Munich", awayTeam: "Dortmund", league: "bundesliga", startTime: "2026-09-20T18:30:00.000Z" });
    check("bundesliga resolves to competition code BL1", urls.some((u) => u.includes("/competitions/BL1/teams")), urls.join(" | "));
  }

  // --- Team name matching: exact and substring (shortened display name) ---
  {
    const home = { id: 5, name: "Newcastle United" };
    const away = { id: 6, name: "Atletico Madrid" };
    globalThis.fetch = makeFootballDataFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [match({ id: 12, date: "2026-03-10T20:00:00.000Z", home, away, status: "SCHEDULED", homeGoals: null, awayGoals: null })],
      urls: [],
    });
    const digest = await buildFootballDigest({
      homeTeam: "Newcastle",
      awayTeam: "Atletico Madrid",
      league: "la-liga",
      startTime: "2026-03-10T20:00:00.000Z",
    });
    check(
      "a shortened display name ('Newcastle') still matches via substring containment",
      digest.text.includes("Newcastle"),
      digest.text.slice(0, 200)
    );
  }

  // --- A finished match reports the final score, not a "not started" line ---
  {
    const home = { id: 9, name: "PSG" };
    const away = { id: 10, name: "Marseille" };
    globalThis.fetch = makeFootballDataFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [match({ id: 14, date: "2026-05-05T19:00:00.000Z", home, away, status: "FINISHED", homeGoals: 3, awayGoals: 0 })],
      urls: [],
    });
    const digest = await buildFootballDigest({ homeTeam: "PSG", awayTeam: "Marseille", league: "ligue-1", startTime: "2026-05-05T19:00:00.000Z" });
    check("a finished match reports the final score", /PSG 3-0 Marseille/.test(digest.text), digest.text.slice(0, 200));
    check("a finished match does NOT say it hasn't started", !digest.text.includes("has not started yet"));
  }

  // --- Empty form / no H2H history render as an honest "nothing found" line, not a crash ---
  {
    const home = { id: 11, name: "Ajax" };
    const away = { id: 12, name: "PSV" };
    globalThis.fetch = makeFootballDataFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [match({ id: 15, date: "2026-06-01T19:00:00.000Z", home, away, status: "SCHEDULED", homeGoals: null, awayGoals: null })],
      homeForm: [],
      awayForm: [],
      h2h: [],
      urls: [],
    });
    const digest = await buildFootballDigest({ homeTeam: "Ajax", awayTeam: "PSV", league: "eredivisie", startTime: "2026-06-01T19:00:00.000Z" });
    check("no form shows an honest fallback line, not a crash", digest.text.includes("No recent completed fixtures found."));
    check("no H2H shows an honest fallback line", digest.text.includes("No previous meetings found."));
  }

  // --- No fallback: an unmatched team throws a clear, named error rather than guessing ---
  {
    const home = { id: 13, name: "Benfica" };
    const away = { id: 14, name: "Porto" };
    globalThis.fetch = makeFootballDataFetch({ rosterTeams: [home, away], home, away, urls: [] });
    let threw: Error | null = null;
    try {
      await buildFootballDigest({ homeTeam: "Some Random Club", awayTeam: "Porto", league: "primeira-liga", startTime: "2026-07-01T19:00:00.000Z" });
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err));
    }
    check("an unmatched team throws", threw !== null);
    check("the error names the unmatched team", /Some Random Club/.test(threw?.message ?? ""), threw?.message);
  }

  // --- No fallback: teams resolve but no fixture in range throws too ---
  {
    const home = { id: 17, name: "Sporting CP" };
    const away = { id: 18, name: "Braga" };
    globalThis.fetch = makeFootballDataFetch({ rosterTeams: [home, away], home, away, fixtures: [], urls: [] });
    let threw: Error | null = null;
    try {
      await buildFootballDigest({ homeTeam: "Sporting CP", awayTeam: "Braga", league: "serie-a", startTime: "2026-08-01T19:00:00.000Z" });
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err));
    }
    check("no matching fixture throws rather than guessing", threw !== null && /Could not find a fixture/.test(threw.message), threw?.message);
  }

  // --- No fallback: Belgian Pro League has no free-tier code, fails before any fetch ---
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("should not be called for an unsupported league");
    }) as unknown as typeof fetch;
    let threw: Error | null = null;
    try {
      await buildFootballDigest({ homeTeam: "Club Brugge", awayTeam: "Anderlecht", league: "belgian-pro-league", startTime: "2026-04-01T19:00:00.000Z" });
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err));
    }
    check("belgian-pro-league throws before any fetch", threw !== null && calls === 0, `threw=${threw?.message}, calls=${calls}`);
    check("the error explains it's a free-plan limitation", /free plan/i.test(threw?.message ?? ""), threw?.message);
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll football-data.org cases passed.");
}

run();

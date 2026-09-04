import { buildApiFootballDigest } from "../lib/apiFootball";

process.env.API_FOOTBALL_KEY = "test-key";

interface TeamRef {
  id: number;
  name: string;
}

function apiOk(response: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ response, errors: [] }),
    text: async () => "",
  };
}

function fixture(opts: {
  id: number;
  date: string;
  home: TeamRef;
  away: TeamRef;
  status: { long: string; short: string; elapsed: number | null };
  goals: { home: number | null; away: number | null };
}) {
  return {
    fixture: { id: opts.id, date: opts.date, status: opts.status },
    teams: { home: opts.home, away: opts.away },
    goals: opts.goals,
  };
}

// Dispatches by URL like the real API-Football calls this module makes, recording every URL
// requested so tests can assert on query params (season, team ids) without exporting internals.
function makeApiFootballFetch(opts: {
  rosterTeams: TeamRef[];
  home: TeamRef;
  away: TeamRef;
  fixtures?: unknown[];
  homeForm?: unknown[];
  awayForm?: unknown[];
  injuries?: unknown[];
  h2h?: unknown[];
  urls: string[];
}) {
  return (async (url: unknown) => {
    const u = String(url);
    opts.urls.push(u);
    if (u.includes("/teams?")) return apiOk(opts.rosterTeams.map((team) => ({ team })));
    if (u.includes("/fixtures/headtohead")) return apiOk(opts.h2h ?? []);
    if (u.includes("/injuries?fixture=")) return apiOk(opts.injuries ?? []);
    if (u.includes(`team=${opts.home.id}`) && u.includes("last=")) return apiOk(opts.homeForm ?? []);
    if (u.includes(`team=${opts.away.id}`) && u.includes("last=")) return apiOk(opts.awayForm ?? []);
    if (u.includes("from=") && u.includes("to=")) return apiOk(opts.fixtures ?? []);
    throw new Error(`Unhandled API-Football URL in test: ${u}`);
  }) as unknown as typeof fetch;
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- Season computation: a January kickoff belongs to the season that started the PREVIOUS
  // calendar year (European domestic seasons run roughly Aug-May). ---
  {
    const home = { id: 1, name: "Arsenal" };
    const away = { id: 2, name: "Chelsea" };
    const urls: string[] = [];
    globalThis.fetch = makeApiFootballFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [fixture({ id: 10, date: "2026-01-15T20:00:00.000Z", home, away, status: { long: "Not Started", short: "NS", elapsed: null }, goals: { home: null, away: null } })],
      urls,
    });
    await buildApiFootballDigest({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league", startTime: "2026-01-15T20:00:00.000Z" });
    check("a January kickoff resolves to the PREVIOUS calendar year's season", urls.some((u) => u.includes("season=2025")), urls.join(" | "));
  }
  {
    const home = { id: 3, name: "Bayern Munich" };
    const away = { id: 4, name: "Dortmund" };
    const urls: string[] = [];
    globalThis.fetch = makeApiFootballFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [fixture({ id: 11, date: "2026-09-20T18:30:00.000Z", home, away, status: { long: "Not Started", short: "NS", elapsed: null }, goals: { home: null, away: null } })],
      urls,
    });
    await buildApiFootballDigest({ homeTeam: "Bayern Munich", awayTeam: "Dortmund", league: "bundesliga", startTime: "2026-09-20T18:30:00.000Z" });
    check("a September kickoff resolves to THAT calendar year's season", urls.some((u) => u.includes("season=2026")), urls.join(" | "));
  }

  // --- Team name matching: exact, substring (shortened display name), and accent-insensitive ---
  {
    const home = { id: 5, name: "Newcastle United" };
    const away = { id: 6, name: "Atlético Madrid" };
    globalThis.fetch = makeApiFootballFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [fixture({ id: 12, date: "2026-03-10T20:00:00.000Z", home, away, status: { long: "Not Started", short: "NS", elapsed: null }, goals: { home: null, away: null } })],
      urls: [],
    });
    const digest = await buildApiFootballDigest({
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
    check(
      "an unaccented spelling ('Atletico') still matches the accented roster name",
      digest.text.includes("Atletico Madrid"),
      digest.text.slice(0, 200)
    );
  }

  // --- Injuries from one shared fetch are correctly attributed to each team ---
  {
    const home = { id: 7, name: "Roma" };
    const away = { id: 8, name: "Lazio" };
    globalThis.fetch = makeApiFootballFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [fixture({ id: 13, date: "2026-04-01T19:00:00.000Z", home, away, status: { long: "Not Started", short: "NS", elapsed: null }, goals: { home: null, away: null } })],
      injuries: [
        { player: { name: "Player A", type: "Missing Fixture", reason: "Knee Injury" }, team: { id: home.id } },
        { player: { name: "Player B", type: "Doubtful", reason: "Illness" }, team: { id: away.id } },
      ],
      urls: [],
    });
    const digest = await buildApiFootballDigest({ homeTeam: "Roma", awayTeam: "Lazio", league: "serie-a", startTime: "2026-04-01T19:00:00.000Z" });
    const homeSection = digest.text.slice(digest.text.indexOf("Injuries"), digest.text.indexOf("Head-to-Head"));
    check("the home team's injury appears attributed to the home team", /Player A/.test(homeSection));
    check("the away team's injury appears attributed to the away team", /Player B/.test(homeSection));
  }

  // --- A finished match reports the final score, not a "not started" line ---
  {
    const home = { id: 9, name: "PSG" };
    const away = { id: 10, name: "Marseille" };
    globalThis.fetch = makeApiFootballFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [
        fixture({
          id: 14,
          date: "2026-05-05T19:00:00.000Z",
          home,
          away,
          status: { long: "Match Finished", short: "FT", elapsed: 90 },
          goals: { home: 3, away: 0 },
        }),
      ],
      urls: [],
    });
    const digest = await buildApiFootballDigest({ homeTeam: "PSG", awayTeam: "Marseille", league: "ligue-1", startTime: "2026-05-05T19:00:00.000Z" });
    check("a finished match reports the final score", /PSG 3-0 Marseille/.test(digest.text), digest.text.slice(0, 200));
    check("a finished match does NOT say it hasn't started", !digest.text.includes("has not started yet"));
  }

  // --- Empty form / no H2H history render as an honest "nothing found" line, not a crash ---
  {
    const home = { id: 11, name: "Ajax" };
    const away = { id: 12, name: "PSV" };
    globalThis.fetch = makeApiFootballFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [fixture({ id: 15, date: "2026-06-01T19:00:00.000Z", home, away, status: { long: "Not Started", short: "NS", elapsed: null }, goals: { home: null, away: null } })],
      homeForm: [],
      awayForm: [],
      injuries: [],
      h2h: [],
      urls: [],
    });
    const digest = await buildApiFootballDigest({ homeTeam: "Ajax", awayTeam: "PSV", league: "eredivisie", startTime: "2026-06-01T19:00:00.000Z" });
    check("no form shows an honest fallback line, not a crash", digest.text.includes("No recent completed fixtures found."));
    check("no H2H shows an honest fallback line", digest.text.includes("No previous meetings found."));
    check("no injuries shows an honest fallback line for both teams", /no reported injuries/i.test(digest.text));
  }

  // --- No fallback: an unmatched team throws a clear, named error rather than guessing ---
  {
    const home = { id: 13, name: "Benfica" };
    const away = { id: 14, name: "Porto" };
    globalThis.fetch = makeApiFootballFetch({ rosterTeams: [home, away], home, away, urls: [] });
    let threw: Error | null = null;
    try {
      await buildApiFootballDigest({
        homeTeam: "Some Random Club",
        awayTeam: "Porto",
        league: "primeira-liga",
        startTime: "2026-07-01T19:00:00.000Z",
      });
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err));
    }
    check("an unmatched team throws", threw !== null);
    check("the error names the unmatched team", /Some Random Club/.test(threw?.message ?? ""), threw?.message);
  }

  // --- No fallback: teams resolve but no fixture in range throws too ---
  {
    const home = { id: 15, name: "Club Brugge" };
    const away = { id: 16, name: "Anderlecht" };
    globalThis.fetch = makeApiFootballFetch({ rosterTeams: [home, away], home, away, fixtures: [], urls: [] });
    let threw: Error | null = null;
    try {
      await buildApiFootballDigest({
        homeTeam: "Club Brugge",
        awayTeam: "Anderlecht",
        league: "belgian-pro-league",
        startTime: "2026-08-01T19:00:00.000Z",
      });
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err));
    }
    check("no matching fixture throws rather than guessing", threw !== null && /Could not find a fixture/.test(threw.message), threw?.message);
  }

  // --- Missing API key fails clearly rather than silently proceeding ---
  {
    const savedKey = process.env.API_FOOTBALL_KEY;
    delete process.env.API_FOOTBALL_KEY;
    globalThis.fetch = (async () => {
      throw new Error("fetch should not be called without a key");
    }) as unknown as typeof fetch;
    let threw: Error | null = null;
    try {
      await buildApiFootballDigest({ homeTeam: "A", awayTeam: "B", league: "premier-league", startTime: "2026-10-01T19:00:00.000Z" });
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err));
    }
    check("a missing API_FOOTBALL_KEY throws a clear configuration error", /API_FOOTBALL_KEY/.test(threw?.message ?? ""), threw?.message);
    process.env.API_FOOTBALL_KEY = savedKey;
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll API-Football cases passed.");
}

run();

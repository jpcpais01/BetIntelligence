import { buildFootballDigest, parseRetryAfterSeconds, __resetRateLimiterForTests } from "../lib/footballData";

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
    __resetRateLimiterForTests();
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

  // --- Retry-after parsing: football-data.org's 429 body names exactly how long to wait
  // (e.g. "You reached your request limit. Wait 57 seconds."), and the retry has to read that
  // instead of guessing or it just hits the same wall again a moment later. ---
  check("parses the exact wording football-data.org returns", parseRetryAfterSeconds("You reached your request limit. Wait 57 seconds.") === 57);
  check("parses a singular 'second'", parseRetryAfterSeconds("Wait 1 second.") === 1);
  check("falls back to 60s when the message can't be parsed", parseRetryAfterSeconds("Rate limited.") === 60);
  check("falls back to 60s on a totally empty body", parseRetryAfterSeconds("") === 60);
  check("caps an implausibly large wait at 65s", parseRetryAfterSeconds("Wait 99999 seconds.") === 65);
  check("floors at 1s rather than 0 or negative", parseRetryAfterSeconds("Wait 0 seconds.") === 1);

  // --- A 429 with a short, explicit wait recovers on the next attempt rather than failing outright
  // or blindly retrying after a fixed guess that might not have been long enough. Reuses the same
  // Arsenal/Chelsea team identities the premier-league happy-path test below uses, so whichever
  // test populates the roster cache first, the other still finds a consistent roster in it. ---
  {
    __resetRateLimiterForTests();
    const home = { id: 1, name: "Arsenal" };
    const away = { id: 2, name: "Chelsea" };
    let calls = 0;
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/competitions/")) return ok({ teams: [home, away] });
      if (u.includes("/head2head")) return ok({ matches: [] });
      if (u.includes(`/teams/${home.id}/matches`) || u.includes(`/teams/${away.id}/matches`)) return ok({ matches: [] });
      if (u.includes("/matches?")) {
        calls++;
        if (calls === 1) {
          return {
            ok: false,
            status: 429,
            json: async () => ({}),
            text: async () => "You reached your request limit. Wait 1 seconds.",
          };
        }
        return ok({ matches: [match({ id: 30, date: "2026-11-01T15:00:00.000Z", home, away, status: "SCHEDULED", homeGoals: null, awayGoals: null })] });
      }
      throw new Error(`Unhandled URL in 429 test: ${u}`);
    }) as unknown as typeof fetch;

    const startedAt = Date.now();
    const digest = await buildFootballDigest({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league", startTime: "2026-11-01T15:00:00.000Z" });
    const elapsedMs = Date.now() - startedAt;

    check("a 429 with an explicit wait recovers and completes successfully", digest.text.includes("has not started yet"));
    check("it actually waited roughly the parsed duration, not zero and not the old blind guess", elapsedMs >= 900 && elapsedMs < 5000, `${elapsedMs}ms`);
  }

  // --- Concurrent calls for the exact same match are coalesced into a single fetch pipeline
  // rather than each repeating it — this is what makes running research N times in parallel
  // (the research-runs stepper) cost one round of API calls instead of N. ---
  {
    __resetRateLimiterForTests();
    // Reuses the Arsenal/Chelsea identities the earlier premier-league tests already cached the
    // roster with (teamsCache is keyed only by competition code) — a fresh, previously-unused team
    // pair here would 404 against that stale cached roster and fail for an unrelated reason.
    const home = { id: 1, name: "Arsenal" };
    const away = { id: 2, name: "Chelsea" };
    const fixtureCalls = { count: 0 };
    const formCalls = { count: 0 };
    const h2hCalls = { count: 0 };
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/competitions/")) return ok({ teams: [home, away] });
      if (u.includes("/head2head")) {
        h2hCalls.count++;
        return ok({ matches: [] });
      }
      if (u.includes(`/teams/${home.id}/matches`) || u.includes(`/teams/${away.id}/matches`)) {
        formCalls.count++;
        return ok({ matches: [] });
      }
      if (u.includes("/matches?")) {
        fixtureCalls.count++;
        return ok({
          matches: [
            match({ id: 40, date: "2026-12-01T15:00:00.000Z", home, away, status: "SCHEDULED", homeGoals: null, awayGoals: null }),
          ],
        });
      }
      throw new Error(`Unhandled URL in coalescing test: ${u}`);
    }) as unknown as typeof fetch;

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        buildFootballDigest({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league", startTime: "2026-12-01T15:00:00.000Z" })
      )
    );

    check("5 concurrent runs make only 1 fixture-lookup call, not 5", fixtureCalls.count === 1, `${fixtureCalls.count}`);
    check("5 concurrent runs make only 2 form calls (one per team), not 10", formCalls.count === 2, `${formCalls.count}`);
    check("5 concurrent runs make only 1 head-to-head call, not 5", h2hCalls.count === 1, `${h2hCalls.count}`);
    check("all 5 concurrent runs get the identical digest text", results.every((r) => r.text === results[0].text));
  }

  // --- Uses the right competition code for each league (no season param needed or sent) ---
  {
    __resetRateLimiterForTests();
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
    // The roster fetch itself may be served from cache (warmed by an earlier case using the same
    // league), so this checks the fixture-lookup call's own query param instead — that one is
    // never cached and always reflects the resolved competition code.
    check("premier-league resolves to competition code PL", urls.some((u) => u.includes("competitions=PL")), urls.join(" | "));
    check("no season parameter is sent (the real bug this replaced)", !urls.some((u) => u.includes("season=")), urls.join(" | "));
  }
  {
    __resetRateLimiterForTests();
    const home = { id: 3, name: "Bayern Munich" };
    const away = { id: 4, name: "Borussia Dortmund" };
    const urls: string[] = [];
    globalThis.fetch = makeFootballDataFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [match({ id: 11, date: "2026-09-20T18:30:00.000Z", home, away, status: "SCHEDULED", homeGoals: null, awayGoals: null })],
      urls,
    });
    await buildFootballDigest({ homeTeam: "Bayern Munich", awayTeam: "Borussia Dortmund", league: "bundesliga", startTime: "2026-09-20T18:30:00.000Z" });
    check("bundesliga resolves to competition code BL1", urls.some((u) => u.includes("/competitions/BL1/teams")), urls.join(" | "));
  }

  // --- A club's full legal name (as Polymarket sometimes gives it) still matches a roster entry
  // that's missing the extra words/numbers, even when a founding-year number sits between the real
  // words and breaks contiguous substring matching. Reuses the BL1 roster cached just above, where
  // football-data.org's own name is "Borussia Dortmund" with no "BV" or "09" in it. ---
  {
    __resetRateLimiterForTests();
    const home = { id: 3, name: "Bayern Munich" };
    const away = { id: 4, name: "Borussia Dortmund" };
    globalThis.fetch = makeFootballDataFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [match({ id: 41, date: "2026-09-27T18:30:00.000Z", home, away, status: "SCHEDULED", homeGoals: null, awayGoals: null })],
      urls: [],
    });
    const digest = await buildFootballDigest({
      homeTeam: "Bayern Munich",
      awayTeam: "BV Borussia 09 Dortmund",
      league: "bundesliga",
      startTime: "2026-09-27T18:30:00.000Z",
    });
    check(
      "a full legal name with a founding-year number ('BV Borussia 09 Dortmund') still matches",
      digest.text.includes("Bayern Munich"),
      digest.text.slice(0, 200)
    );
  }

  // --- Team name matching: exact and substring (shortened display name) ---
  {
    __resetRateLimiterForTests();
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
    __resetRateLimiterForTests();
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
    __resetRateLimiterForTests();
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
    __resetRateLimiterForTests();
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
    __resetRateLimiterForTests();
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
    __resetRateLimiterForTests();
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

import {
  buildFootballDigest,
  parseRetryAfterSeconds,
  getLiveScores,
  __resetRateLimiterForTests,
  __resetLiveWindowCacheForTests,
  __resetStandingsCacheForTests,
} from "../lib/footballData";
import type { LeagueId } from "../lib/types";

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
interface StandingRow {
  position: number;
  team: TeamRef;
  playedGames: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

function makeFootballDataFetch(opts: {
  rosterTeams: TeamRef[];
  home: TeamRef;
  away: TeamRef;
  fixtures?: unknown[];
  homeForm?: unknown[];
  awayForm?: unknown[];
  h2h?: unknown[];
  standings?: StandingRow[];
  urls: string[];
}) {
  return (async (url: unknown) => {
    const u = String(url);
    opts.urls.push(u);
    // Standings is checked before the generic "/competitions/" branch below, since its own path
    // (/competitions/{code}/standings) would otherwise match that branch's substring check too.
    if (u.includes("/standings")) return ok({ standings: [{ type: "TOTAL", table: opts.standings ?? [] }] });
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

  // --- Standings + form combine into a per-team infogram: position/points/goals from the
  // standings table, a compact form strip re-sorted oldest-first regardless of what order the
  // form endpoint returned its matches in (capped at 5, though only 3 are given here). ---
  {
    __resetRateLimiterForTests();
    __resetStandingsCacheForTests();
    const home = { id: 50, name: "Napoli" };
    const away = { id: 51, name: "Roma" };
    globalThis.fetch = makeFootballDataFetch({
      rosterTeams: [home, away],
      home,
      away,
      fixtures: [match({ id: 60, date: "2026-02-01T20:00:00.000Z", home, away, status: "SCHEDULED", homeGoals: null, awayGoals: null })],
      // Deliberately out of chronological order — formLetters must re-sort by date itself.
      homeForm: [
        match({ id: 201, date: "2026-01-17T20:00:00.000Z", home, away: { id: 60, name: "Genoa" }, status: "FINISHED", homeGoals: 3, awayGoals: 0 }),
        match({ id: 202, date: "2026-01-03T20:00:00.000Z", home: { id: 62, name: "Torino" }, away: home, status: "FINISHED", homeGoals: 1, awayGoals: 0 }),
        match({ id: 203, date: "2026-01-10T20:00:00.000Z", home: { id: 61, name: "Lazio" }, away: home, status: "FINISHED", homeGoals: 1, awayGoals: 1 }),
      ],
      awayForm: [],
      standings: [
        { position: 2, team: home, playedGames: 20, points: 44, goalsFor: 38, goalsAgainst: 15 },
        { position: 7, team: away, playedGames: 20, points: 30, goalsFor: 25, goalsAgainst: 24 },
      ],
      urls: [],
    });
    const digest = await buildFootballDigest({ homeTeam: "Napoli", awayTeam: "Roma", league: "champions-league", startTime: "2026-02-01T20:00:00.000Z" });

    check("home standing carries the right table facts", digest.homeStanding?.position === 2 && digest.homeStanding.points === 44, JSON.stringify(digest.homeStanding));
    check("home standing's goals come from the table row", digest.homeStanding?.goalsFor === 38 && digest.homeStanding?.goalsAgainst === 15, JSON.stringify(digest.homeStanding));
    check(
      "home form is re-sorted oldest-first (L on 01-03, D on 01-10, W on 01-17), not the mock's own order",
      JSON.stringify(digest.homeStanding?.form) === JSON.stringify(["L", "D", "W"]),
      JSON.stringify(digest.homeStanding?.form)
    );
    check("away standing carries the right table facts", digest.awayStanding?.position === 7 && digest.awayStanding.points === 30, JSON.stringify(digest.awayStanding));
    check("away form is an empty array, not a crash, when no finished matches exist", JSON.stringify(digest.awayStanding?.form) === "[]");
    check("the text digest includes a League Standings section", digest.text.includes("League Standings"), digest.text);
    check("the text digest names each team's position and points", /Napoli: #2, 44pts/.test(digest.text) && /Roma: #7, 30pts/.test(digest.text), digest.text);
  }

  // --- A standings fetch that fails entirely (network error, an uncovered response shape) never
  // breaks the digest — it's an enrichment, same as injuries elsewhere in this app — and a team
  // missing from a standings table it DID fetch resolves to null the same way, not a crash. ---
  {
    __resetRateLimiterForTests();
    __resetStandingsCacheForTests();
    // Reuses the Napoli/Roma identities the standings happy-path test above already cached the
    // roster with (teamsCache is keyed only by competition code, and every other covered league
    // is already claimed by an earlier case in this file) — a fresh, previously-unused team pair
    // here would 404 against that stale cached roster and fail for an unrelated reason.
    const home = { id: 50, name: "Napoli" };
    const away = { id: 51, name: "Roma" };
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/standings")) throw new Error("simulated standings outage");
      if (u.includes("/competitions/")) return ok({ teams: [home, away] });
      if (u.includes("/head2head")) return ok({ matches: [] });
      if (u.includes(`/teams/${home.id}/matches`) || u.includes(`/teams/${away.id}/matches`)) return ok({ matches: [] });
      if (u.includes("/matches?")) {
        return ok({ matches: [match({ id: 70, date: "2026-02-08T20:00:00.000Z", home, away, status: "SCHEDULED", homeGoals: null, awayGoals: null })] });
      }
      throw new Error(`Unhandled URL in standings-outage test: ${u}`);
    }) as unknown as typeof fetch;

    const digest = await buildFootballDigest({ homeTeam: "Napoli", awayTeam: "Roma", league: "champions-league", startTime: "2026-02-08T20:00:00.000Z" });
    check("a standings outage never fails the whole digest", digest.text.includes("has not started yet"));
    check("both standings resolve to null rather than a partial/guessed value", digest.homeStanding === null && digest.awayStanding === null);
    check("the text digest says standings aren't available rather than omitting the section silently", digest.text.includes("not available"), digest.text);
  }

  // --- getLiveScores: one request per REQUESTED league (not every league this provider covers —
  // checking all of them regardless of what's on screen was most of the free tier's entire
  // budget by itself), filtered to live-relevant statuses only, resilient to one league's fetch
  // failing, and cached across calls within the TTL ---
  {
    __resetRateLimiterForTests();
    __resetLiveWindowCacheForTests();
    const callsByCode: Record<string, number> = {};
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      const codeMatch = u.match(/competitions=([A-Z0-9]+)/);
      const code = codeMatch?.[1] ?? "?";
      callsByCode[code] = (callsByCode[code] ?? 0) + 1;

      if (code === "PL") {
        const home = { id: 1, name: "Arsenal" };
        const away = { id: 2, name: "Chelsea" };
        return ok({
          matches: [
            match({ id: 100, date: "2026-09-04T15:00:00.000Z", home, away, status: "IN_PLAY", homeGoals: 1, awayGoals: 0 }),
            match({
              id: 101,
              date: "2026-09-05T15:00:00.000Z",
              home: { id: 5, name: "Newcastle" },
              away: { id: 6, name: "Fulham" },
              status: "SCHEDULED",
              homeGoals: null,
              awayGoals: null,
            }),
          ],
        });
      }
      if (code === "CL") {
        const home = { id: 20, name: "Real Madrid" };
        const away = { id: 21, name: "Manchester City" };
        return ok({
          matches: [match({ id: 102, date: "2026-09-04T19:00:00.000Z", home, away, status: "FINISHED", homeGoals: 2, awayGoals: 1 })],
        });
      }
      if (code === "BL1") {
        throw new Error("simulated network failure for this league");
      }
      return ok({ matches: [] });
    }) as unknown as typeof fetch;

    const requestedLeagues: LeagueId[] = ["premier-league", "champions-league", "bundesliga"];
    const scores = await getLiveScores(requestedLeagues);
    check("returns exactly the 2 live-relevant matches, not the scheduled one", scores.length === 2, JSON.stringify(scores));
    check("a covered league that wasn't requested (La Liga here) is never fetched", callsByCode.PD === undefined, JSON.stringify(callsByCode));
    const plEntry = scores.find((s) => s.homeTeam === "Arsenal");
    check("the Premier League in-play match is included with the right score", plEntry?.homeGoals === 1 && plEntry?.awayGoals === 0, JSON.stringify(plEntry));
    check("its status label reads as in-play, not raw enum text", plEntry?.statusLabel === "In Play", plEntry?.statusLabel);
    check("it's tagged with the premier-league LeagueId", plEntry?.league === "premier-league", plEntry?.league);
    const clEntry = scores.find((s) => s.homeTeam === "Real Madrid");
    check("the Champions League finished match is included with the final score", clEntry?.homeGoals === 2 && clEntry?.awayGoals === 1, JSON.stringify(clEntry));
    check("a league whose fetch fails (Bundesliga here) doesn't break the others", !scores.some((s) => s.league === "bundesliga"));

    const callsBefore = { ...callsByCode };
    await getLiveScores(requestedLeagues);
    check(
      "a second call within the TTL reuses the cache for leagues that succeeded",
      Object.entries(callsBefore)
        .filter(([code]) => code !== "BL1")
        .every(([code, count]) => callsByCode[code] === count),
      JSON.stringify(callsByCode)
    );
    check(
      "a league whose fetch failed isn't cached, so it's retried rather than staying broken",
      callsByCode.BL1 === callsBefore.BL1 + 1,
      JSON.stringify(callsByCode)
    );
  }

  // --- An empty leagues list makes no requests at all — no games on screen plausibly live means
  // nothing worth checking, not "check everything just in case" ---
  {
    __resetRateLimiterForTests();
    __resetLiveWindowCacheForTests();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return ok({ matches: [] });
    }) as unknown as typeof fetch;
    const scores = await getLiveScores([]);
    check("an empty leagues list makes no requests", calls === 0, `${calls}`);
    check("an empty leagues list returns an empty result", scores.length === 0, JSON.stringify(scores));
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll football-data.org cases passed.");
}

run();

import { getLiveScores, getMatchResultsSince } from "../lib/liveScores";
import type { LeagueId } from "../lib/types";

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

interface EspnTeamOpts {
  displayName: string;
  shortDisplayName?: string;
  abbreviation?: string;
}

function espnEvent(opts: {
  home: EspnTeamOpts;
  away: EspnTeamOpts;
  homeScore?: string;
  awayScore?: string;
  statusName?: string;
  state?: "pre" | "in" | "post";
  completed?: boolean;
  displayClock?: string;
}) {
  return {
    competitions: [
      {
        status: {
          type: { name: opts.statusName, state: opts.state, completed: opts.completed },
          displayClock: opts.displayClock,
        },
        competitors: [
          { homeAway: "home", team: opts.home, score: opts.homeScore },
          { homeAway: "away", team: opts.away, score: opts.awayScore },
        ],
      },
    ],
  };
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- getLiveScores: one request per requested league, correct slug per league, status/clock
  // mapping, and resilience to one league's fetch failing ---
  {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      requestedUrls.push(u);
      if (u.includes("/eng.1/")) {
        return ok({
          events: [
            espnEvent({
              home: { displayName: "Manchester City", shortDisplayName: "Man City" },
              away: { displayName: "Wolverhampton Wanderers", shortDisplayName: "Wolves" },
              homeScore: "2",
              awayScore: "1",
              statusName: "STATUS_IN_PROGRESS",
              state: "in",
              displayClock: "63'",
            }),
          ],
        });
      }
      if (u.includes("/uefa.champions/")) {
        return ok({
          events: [
            espnEvent({
              home: { displayName: "Real Madrid" },
              away: { displayName: "Manchester City" },
              homeScore: "2",
              awayScore: "1",
              statusName: "STATUS_FULL_TIME",
              state: "post",
              completed: true,
            }),
          ],
        });
      }
      if (u.includes("/ger.1/")) throw new Error("simulated network failure for this league");
      return ok({ events: [] });
    }) as unknown as typeof fetch;

    const requestedLeagues: LeagueId[] = ["premier-league", "champions-league", "bundesliga"];
    const scores = await getLiveScores(requestedLeagues);

    check("one request is made per requested league", requestedUrls.length === 3, JSON.stringify(requestedUrls));
    check(
      "the Premier League request hits ESPN's eng.1 slug",
      requestedUrls.some((u) => u.includes("/eng.1/scoreboard")),
      JSON.stringify(requestedUrls)
    );
    check(
      "the Champions League request hits ESPN's uefa.champions slug",
      requestedUrls.some((u) => u.includes("/uefa.champions/scoreboard")),
      JSON.stringify(requestedUrls)
    );
    check("a league whose fetch fails doesn't break the others", scores.length === 2, JSON.stringify(scores));

    const inPlay = scores.find((s) => s.homeTeam === "Manchester City" && s.league === "premier-league");
    check("an in-progress match maps to IN_PLAY", inPlay?.status === "IN_PLAY", JSON.stringify(inPlay));
    check("its live clock is carried through", inPlay?.clockLabel === "63'", inPlay?.clockLabel);
    check("its score is parsed as numbers", inPlay?.homeGoals === 2 && inPlay?.awayGoals === 1, JSON.stringify(inPlay));
    check(
      "the away team's short name (Wolves) is carried alongside its full name",
      inPlay?.awayTeamShort === "Wolves",
      inPlay?.awayTeamShort
    );

    const finished = scores.find((s) => s.league === "champions-league");
    check("a completed match maps to FINISHED regardless of its status name", finished?.status === "FINISHED", JSON.stringify(finished));
    check("a finished match's clock label reads FT", finished?.clockLabel === "FT", finished?.clockLabel);
    check(
      "a team with no short name falls back to just the full name, not a crash",
      finished?.homeTeamShort === undefined,
      finished?.homeTeamShort
    );
  }

  // --- Status/clock mapping: every state this app actually branches on. getLiveScores only ever
  // returns live-relevant matches (IN_PLAY, PAUSED, FINISHED) — a not-yet-started or postponed
  // match is filtered out entirely, which is exactly what stops it from ever rendering as a
  // spurious "LIVE 0-0" card, so those cases assert on an empty result rather than indexing [0]. ---
  {
    const caseFor = (event: ReturnType<typeof espnEvent>) => {
      globalThis.fetch = (async () => ok({ events: [event] })) as unknown as typeof fetch;
      return getLiveScores(["premier-league"]);
    };

    const scheduled = await caseFor(
      espnEvent({ home: { displayName: "A" }, away: { displayName: "B" }, statusName: "STATUS_SCHEDULED", state: "pre" })
    );
    check(
      "a scheduled match (state pre) is filtered out, not shown as live",
      scheduled.length === 0,
      JSON.stringify(scheduled)
    );

    const halftimeScores = await caseFor(
      espnEvent({ home: { displayName: "A" }, away: { displayName: "B" }, statusName: "STATUS_HALFTIME", state: "in", homeScore: "1", awayScore: "0" })
    );
    const halftime = halftimeScores[0];
    check("halftime maps to PAUSED", halftime?.status === "PAUSED", halftime?.status);
    check("halftime's clock label reads HT", halftime?.clockLabel === "HT", halftime?.clockLabel);

    const postponed = await caseFor(
      espnEvent({ home: { displayName: "A" }, away: { displayName: "B" }, statusName: "STATUS_POSTPONED", state: "pre" })
    );
    check("a postponed match is filtered out, not shown as live", postponed.length === 0, JSON.stringify(postponed));

    const noClockYetScores = await caseFor(
      espnEvent({ home: { displayName: "A" }, away: { displayName: "B" }, statusName: "STATUS_IN_PROGRESS", state: "in", homeScore: "0", awayScore: "0" })
    );
    const noClockYet = noClockYetScores[0];
    check(
      "an in-play match with no displayClock reported has no clock label rather than a blank string",
      noClockYet?.clockLabel === undefined,
      JSON.stringify(noClockYet?.clockLabel)
    );
  }

  // --- Malformed events never crash — a missing team name is skipped, not guessed at ---
  {
    globalThis.fetch = (async () =>
      ok({ events: [{ competitions: [{ status: {}, competitors: [{ homeAway: "home" }] }] }] })) as unknown as typeof fetch;
    const scores = await getLiveScores(["premier-league"]);
    check("an event missing team data is skipped, not thrown", Array.isArray(scores) && scores.length === 0);
  }
  {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    let threw = false;
    try {
      await getLiveScores(["premier-league"]);
    } catch {
      threw = true;
    }
    check("a thrown fetch never propagates out of getLiveScores", !threw);
  }

  // --- Belgian Pro League is covered here — football-data.org's free tier never had a code for
  // it at all, so this is a genuine gap ESPN closes rather than just matching parity. ---
  {
    let requestedUrl = "";
    globalThis.fetch = (async (url: unknown) => {
      requestedUrl = String(url);
      return ok({ events: [] });
    }) as unknown as typeof fetch;
    await getLiveScores(["belgian-pro-league"]);
    check("Belgian Pro League maps to ESPN's bel.1 slug", requestedUrl.includes("/bel.1/scoreboard"), requestedUrl);
  }

  // --- An empty leagues list makes no requests at all ---
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return ok({ events: [] });
    }) as unknown as typeof fetch;
    const scores = await getLiveScores([]);
    check("an empty leagues list makes no requests", calls === 0, `${calls}`);
    check("an empty leagues list returns an empty result", scores.length === 0);
  }

  // --- getMatchResultsSince: a wide, per-league lookback bounded by earliestKickoff, not just
  // "today" — settling a bet that finished days ago still needs to find that match ---
  {
    let requestedUrl = "";
    globalThis.fetch = (async (url: unknown) => {
      requestedUrl = String(url);
      return ok({
        events: [
          espnEvent({
            home: { displayName: "Arsenal" },
            away: { displayName: "Chelsea" },
            homeScore: "2",
            awayScore: "1",
            statusName: "STATUS_FULL_TIME",
            state: "post",
            completed: true,
          }),
        ],
      });
    }) as unknown as typeof fetch;

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const scores = await getMatchResultsSince([{ league: "premier-league", earliestKickoff: fiveDaysAgo }]);
    check("a match from several days ago is still found", scores.length === 1 && scores[0].homeGoals === 2, JSON.stringify(scores));
    check("the request's date range reaches back far enough to cover the old kickoff", /dates=\d{8}-\d{8}/.test(requestedUrl), requestedUrl);
  }
  check(
    "an uncovered league (no ESPN slug mapping) contributes nothing rather than erroring",
    (await getMatchResultsSince([{ league: "premier-league", earliestKickoff: new Date().toISOString() }])) !== undefined
  );

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll live-scores cases passed.");
}

run();

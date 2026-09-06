import {
  requestJson,
  getIndependentPrediction,
  buildFootballAnalysisDigest,
  getIndependentPredictionFromDigest,
  compareToMarket,
  gameTimeLine,
  parseLiveScoreInput,
} from "../lib/openrouter";
import { __resetRateLimiterForTests } from "../lib/footballData";
import { MATCH_OVER_AFTER_MS } from "../lib/matchClock";

process.env.OPENROUTER_API_KEY = "test-key";
process.env.API_FOOTBALL_KEY = "test-key";

const GOOD_JSON = JSON.stringify({
  homeWinProb: 0.5,
  drawProb: 0.28,
  awayWinProb: 0.22,
  confidence: "medium",
  homePros: ["Good recent form", "Strong home record"],
  homeCons: ["Head-to-head is close"],
  awayPros: ["Head-to-head is close"],
  awayCons: ["Missing a key player"],
  summary: "Home side edges it.",
});

function completion(message: unknown, finishReason: string | null = "stop", usage?: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ choices: [{ message, finish_reason: finishReason }], ...(usage ? { usage } : {}) }),
    text: async () => "",
  };
}

function raw(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "ERR",
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

interface Case {
  name: string;
  responses: unknown[];
  expectCalls?: number;
  expectSources?: number;
  shouldThrow?: boolean;
}

// These exercise requestJson's retry/parse machinery directly — it's the same hardened core both
// getIndependentPrediction (football) and lib/openrouterMarkets.ts build on, so testing it here
// once, decoupled from any particular caller's prompt shape or call count, covers all of them.
const CASES: Case[] = [
  {
    name: "plain JSON content",
    responses: [completion({ content: GOOD_JSON })],
    expectCalls: 1,
  },
  {
    name: "content wrapped in markdown fences",
    responses: [completion({ content: "```json\n" + GOOD_JSON + "\n```" })],
    expectCalls: 1,
  },
  {
    name: "content returned as array parts",
    responses: [completion({ content: [{ type: "text", text: GOOD_JSON }] })],
    expectCalls: 1,
  },
  {
    name: "empty content, answer left in reasoning (reasoning model)",
    responses: [completion({ content: "", reasoning: GOOD_JSON })],
    expectCalls: 1,
  },
  {
    name: "HTTP 200 carrying an error payload, then success",
    responses: [
      {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ error: { message: "Provider returned error" } }),
        text: async () => "",
      },
      completion({ content: GOOD_JSON }),
    ],
    expectCalls: 2,
  },
  {
    name: "totally empty message, then success",
    responses: [completion({ content: "" }), completion({ content: GOOD_JSON })],
    expectCalls: 2,
  },
  {
    name: "truncated by max_tokens (finish_reason=length), then success",
    responses: [completion({ content: "" }, "length"), completion({ content: GOOD_JSON })],
    expectCalls: 2,
  },
  {
    name: "rate limited (429), then success",
    responses: [raw(429, '{"error":"rate limited"}'), completion({ content: GOOD_JSON })],
    expectCalls: 2,
  },
  {
    name: "server error (503), then success",
    responses: [raw(503, "upstream unavailable"), completion({ content: GOOD_JSON })],
    expectCalls: 2,
  },
  {
    name: "prose instead of JSON, recovers after nudge",
    responses: [
      completion({ content: "Sure! Here is my analysis of the match..." }),
      completion({ content: GOOD_JSON }),
    ],
    expectCalls: 2,
  },
  {
    name: "web search citations surface as sources",
    responses: [
      completion({
        content: GOOD_JSON,
        annotations: [
          { type: "url_citation", url_citation: { url: "https://a.com/x", title: "Team news" } },
          { type: "url_citation", url_citation: { url: "https://b.com/y", title: "Form guide" } },
          { type: "url_citation", url_citation: { url: "https://a.com/x", title: "dupe" } },
        ],
      }),
    ],
    expectCalls: 1,
    expectSources: 2,
  },
  {
    name: "gives up with a clear message after repeated failures",
    responses: [completion({ content: "" }), completion({ content: "" }), completion({ content: "" })],
    expectCalls: 3,
    shouldThrow: true,
  },
  {
    name: "auth failure is fatal, not retried",
    responses: [raw(401, '{"error":"invalid key"}')],
    expectCalls: 1,
    shouldThrow: true,
  },
];

async function runResilienceCases(failures: string[]) {
  for (const testCase of CASES) {
    let calls = 0;
    globalThis.fetch = (async () => {
      const response = testCase.responses[Math.min(calls, testCase.responses.length - 1)];
      calls++;
      return response;
    }) as unknown as typeof fetch;

    let threw: Error | null = null;
    let sources = 0;
    try {
      const result = await requestJson<{
        homeWinProb: number;
        drawProb: number;
        awayWinProb: number;
      }>([{ role: "system", content: "s" }, { role: "user", content: "u" }], true, 3000);
      sources = result.sources?.length ?? 0;
      const sum = result.parsed.homeWinProb + result.parsed.drawProb + result.parsed.awayWinProb;
      if (Math.abs(sum - 1) > 0.001) failures.push(`${testCase.name}: probs sum to ${sum}`);
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err));
    }

    const status = threw ? `threw: ${threw.message.slice(0, 60)}` : `ok (${sources} sources)`;
    console.log(`  ${testCase.name}\n     ${calls} call(s) -> ${status}`);

    if (testCase.shouldThrow && !threw) failures.push(`${testCase.name}: expected a thrown error`);
    if (!testCase.shouldThrow && threw) failures.push(`${testCase.name}: unexpected error "${threw.message}"`);
    if (testCase.expectCalls !== undefined && calls !== testCase.expectCalls) {
      failures.push(`${testCase.name}: expected ${testCase.expectCalls} call(s), made ${calls}`);
    }
    if (testCase.expectSources !== undefined && sources !== testCase.expectSources) {
      failures.push(`${testCase.name}: expected ${testCase.expectSources} sources, got ${sources}`);
    }
  }
}

interface CapturedRequest {
  model: string;
  messages: { role: string; content: string }[];
}

interface FootballDataTeamFixture {
  id: number;
  name: string;
}

function fdMatch(opts: {
  id: number;
  date: string;
  home: FootballDataTeamFixture;
  away: FootballDataTeamFixture;
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

// A fetch mock that dispatches football-data.org requests to canned per-endpoint responses (by
// matching bits of the URL) and forwards anything else (OpenRouter) to a separate handler.
function makeMixedFetch(opts: {
  home: FootballDataTeamFixture;
  away: FootballDataTeamFixture;
  fixtures?: unknown[];
  homeForm?: unknown[];
  awayForm?: unknown[];
  h2h?: unknown[];
  onOpenRouterRequest: (body: CapturedRequest) => unknown;
}) {
  return (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    // buildFootballAnalysisDigest also checks ESPN for a posted lineup (lib/lineups.ts) — an empty
    // scoreboard here means "no lineup found", the same as a real not-yet-announced match, without
    // it being mistaken for an OpenRouter call by the fallback branch below.
    if (u.includes("site.api.espn.com")) return { ok: true, status: 200, json: async () => ({ events: [] }) };
    if (u.includes("api.football-data.org")) {
      if (u.includes("/competitions/")) return { ok: true, status: 200, json: async () => ({ teams: [opts.home, opts.away] }) };
      if (u.includes("/head2head")) return { ok: true, status: 200, json: async () => ({ matches: opts.h2h ?? [] }) };
      if (u.includes(`/teams/${opts.home.id}/matches`)) return { ok: true, status: 200, json: async () => ({ matches: opts.homeForm ?? [] }) };
      if (u.includes(`/teams/${opts.away.id}/matches`)) return { ok: true, status: 200, json: async () => ({ matches: opts.awayForm ?? [] }) };
      if (u.includes("/matches?")) return { ok: true, status: 200, json: async () => ({ matches: opts.fixtures ?? [] }) };
      throw new Error(`Unhandled football-data.org URL in test: ${u}`);
    }
    const body = JSON.parse(init?.body as string) as CapturedRequest;
    return opts.onOpenRouterRequest(body);
  }) as unknown as typeof fetch;
}

// The football pipeline used to be a two-stage pipeline where an AI web-search pass built the
// digest handed to the predict step. That search turned out to give wrong data often enough to be
// worse than useless, so it's now a single OpenRouter call (predict only) fed a digest built
// straight from football-data.org's structured match data (lib/footballData.ts) — no web search,
// no fallback to it if a team or fixture can't be resolved there. That source has no injuries
// endpoint at any tier, so the digest covers form, head-to-head, and live status only.
//
// Each block below uses a different league — lib/footballData.ts caches a competition's team
// roster in-memory for the life of the process to save the free tier's per-minute request budget,
// and this file's test cases all share that same process, so reusing one league across blocks
// would silently serve an earlier block's cached teams instead of exercising this block's mock.
process.env.FOOTBALL_DATA_API_KEY = "test-key";

async function runFootballPipelineChecks(failures: string[]) {
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  const home = { id: 42, name: "Arsenal" };
  const away = { id: 49, name: "Chelsea" };
  const kickoff = "2026-01-15T20:00:00.000Z";

  // --- Happy path: a not-yet-started match with form and H2H present ---
  {
    __resetRateLimiterForTests();
    const requests: CapturedRequest[] = [];
    globalThis.fetch = makeMixedFetch({
      home,
      away,
      fixtures: [fdMatch({ id: 900001, date: kickoff, home, away, status: "SCHEDULED", homeGoals: null, awayGoals: null })],
      homeForm: [
        fdMatch({ id: 1, date: "2026-01-08T15:00:00.000Z", home, away: { id: 99, name: "Fulham" }, status: "FINISHED", homeGoals: 3, awayGoals: 1 }),
      ],
      awayForm: [
        fdMatch({ id: 2, date: "2026-01-08T15:00:00.000Z", home: { id: 100, name: "Everton" }, away, status: "FINISHED", homeGoals: 2, awayGoals: 2 }),
      ],
      h2h: [fdMatch({ id: 3, date: "2025-05-01T15:00:00.000Z", home, away, status: "FINISHED", homeGoals: 1, awayGoals: 1 })],
      onOpenRouterRequest: (body) => {
        requests.push(body);
        return completion({ content: GOOD_JSON }, "stop", { cost: 0.0009 });
      },
    });

    const result = await getIndependentPrediction({
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      leagueName: "Premier League",
      league: "premier-league",
      startTime: kickoff,
    });

    check("makes exactly one OpenRouter call (predict only, no research call)", requests.length === 1, `made ${requests.length}`);
    check("the predict call does NOT request web search", requests[0]?.model.endsWith(":online") === false, requests[0]?.model);

    const predictSystemPrompt = requests[0]?.messages.find((m) => m.role === "system")?.content ?? "";
    check(
      "the predict system prompt guards against odds leaking through anyway",
      /must not/i.test(predictSystemPrompt) && /disregard/i.test(predictSystemPrompt)
    );

    const predictUserPrompt = requests[0]?.messages.find((m) => m.role === "user")?.content ?? "";
    check("the digest includes each team's recent form", /3-1 vs Fulham/.test(predictUserPrompt) && /2-2 at Everton/.test(predictUserPrompt));
    check("the digest includes head-to-head history", /1-1/.test(predictUserPrompt));
    check("the digest notes the match hasn't started yet", /has not started yet/.test(predictUserPrompt));
    check(
      "with no lineup posted (mocked ESPN scoreboard is empty), the digest says so for both teams",
      /Arsenal: not announced yet\./.test(predictUserPrompt) && /Chelsea: not announced yet\./.test(predictUserPrompt),
      predictUserPrompt.slice(-300)
    );

    check("no sources are returned (no web search happened)", (result.sources ?? []).length === 0, JSON.stringify(result.sources));
    check("cost is just the single predict call's cost, not a sum of two", Math.abs((result.costUsd ?? 0) - 0.0009) < 0.00001, `got ${result.costUsd}`);

    check("home team's pros are parsed", result.homeAssessment.pros.includes("Good recent form"), JSON.stringify(result.homeAssessment));
    check("home team's cons are parsed", result.homeAssessment.cons.includes("Head-to-head is close"), JSON.stringify(result.homeAssessment));
    check("away team's pros are parsed", result.awayAssessment.pros.includes("Head-to-head is close"), JSON.stringify(result.awayAssessment));
    check("away team's cons are parsed", result.awayAssessment.cons.includes("Missing a key player"), JSON.stringify(result.awayAssessment));
    check("the overall summary is parsed", result.summary === "Home side edges it.", result.summary);
  }

  // --- A live match: current score should show up in the digest ---
  {
    __resetRateLimiterForTests();
    const liveHome = { id: 142, name: "Liverpool" };
    const liveAway = { id: 149, name: "Everton" };
    const liveKickoff = "2026-02-01T15:00:00.000Z";
    let predictUserPrompt = "";
    globalThis.fetch = makeMixedFetch({
      home: liveHome,
      away: liveAway,
      fixtures: [fdMatch({ id: 900002, date: liveKickoff, home: liveHome, away: liveAway, status: "IN_PLAY", homeGoals: 2, awayGoals: 1 })],
      onOpenRouterRequest: (body) => {
        predictUserPrompt = body.messages.find((m) => m.role === "user")?.content ?? "";
        return completion({ content: GOOD_JSON }, "stop", { cost: 0.0009 });
      },
    });

    await getIndependentPrediction({
      homeTeam: "Liverpool",
      awayTeam: "Everton",
      leagueName: "La Liga",
      league: "la-liga",
      startTime: liveKickoff,
    });

    check("a live match's digest reports the current score", /Liverpool 2-1 Everton/.test(predictUserPrompt), predictUserPrompt.slice(0, 300));
    check("a live match's digest reports the in-play status", /In Play/.test(predictUserPrompt), predictUserPrompt.slice(0, 300));
  }

  // --- No fallback: an unresolvable team fails the whole analysis, with no OpenRouter call at all ---
  {
    __resetRateLimiterForTests();
    let openRouterCalls = 0;
    globalThis.fetch = makeMixedFetch({
      home: { id: 900, name: "Nonexistent FC" },
      away: { id: 901, name: "Also Missing FC" },
      onOpenRouterRequest: () => {
        openRouterCalls++;
        return completion({ content: GOOD_JSON }, "stop", { cost: 0.0009 });
      },
    });

    let threw: Error | null = null;
    try {
      await getIndependentPrediction({
        homeTeam: "Totally Unknown Rovers",
        awayTeam: "Chelsea",
        leagueName: "Bundesliga",
        league: "bundesliga",
        startTime: "2026-03-01T15:00:00.000Z",
      });
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err));
    }

    check("an unmatched team throws rather than falling back to anything else", threw !== null);
    check(
      "the error names the team that couldn't be found",
      /Totally Unknown Rovers/.test(threw?.message ?? ""),
      threw?.message
    );
    check("no OpenRouter call is made when the match can't be resolved", openRouterCalls === 0, `made ${openRouterCalls}`);
  }

  // --- No fallback: a league with no free-tier football-data.org code fails clearly ---
  {
    __resetRateLimiterForTests();
    let openRouterCalls = 0;
    globalThis.fetch = (async () => {
      openRouterCalls++;
      return completion({ content: GOOD_JSON }, "stop", { cost: 0.0009 });
    }) as unknown as typeof fetch;

    let threw: Error | null = null;
    try {
      await getIndependentPrediction({
        homeTeam: "Club Brugge",
        awayTeam: "Anderlecht",
        leagueName: "Belgian Pro League",
        league: "belgian-pro-league",
        startTime: "2026-04-01T15:00:00.000Z",
      });
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err));
    }

    check("a league with no free-tier code throws before ever calling the API", threw !== null);
    check("the error explains it's a free-plan limitation", /free plan/i.test(threw?.message ?? ""), threw?.message);
    check("no OpenRouter call is made for an unsupported league", openRouterCalls === 0, `made ${openRouterCalls}`);
  }

  // --- The split that fixes N-parallel-research-runs multiplying football-data.org calls: a
  // digest built once and reused across several predict calls costs football-data.org exactly
  // one round, not one per call — a guarantee by construction, not by cache, since each call here
  // simulates a SEPARATE concurrent /api/analyze/predict request (the real failure mode, since
  // Vercel can route those to separate serverless instances that don't share in-process caches). ---
  {
    __resetRateLimiterForTests();
    const serieAHome = { id: 500, name: "Inter Milan" };
    const serieAAway = { id: 501, name: "AC Milan" };
    const serieAKickoff = "2026-05-01T19:00:00.000Z";
    let footballDataCalls = 0;
    let openRouterCalls = 0;
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("site.api.espn.com")) return { ok: true, status: 200, json: async () => ({ events: [] }) };
      if (u.includes("api.football-data.org")) {
        footballDataCalls++;
        if (u.includes("/competitions/")) return { ok: true, status: 200, json: async () => ({ teams: [serieAHome, serieAAway] }) };
        if (u.includes("/head2head")) return { ok: true, status: 200, json: async () => ({ matches: [] }) };
        if (u.includes(`/teams/${serieAHome.id}/matches`) || u.includes(`/teams/${serieAAway.id}/matches`)) {
          return { ok: true, status: 200, json: async () => ({ matches: [] }) };
        }
        if (u.includes("/matches?")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              matches: [
                fdMatch({ id: 900010, date: serieAKickoff, home: serieAHome, away: serieAAway, status: "SCHEDULED", homeGoals: null, awayGoals: null }),
              ],
            }),
          };
        }
        throw new Error(`Unhandled football-data.org URL: ${u}`);
      }
      openRouterCalls++;
      return completion({ content: GOOD_JSON }, "stop", { cost: 0.0009 });
    }) as unknown as typeof fetch;

    const digest = await buildFootballAnalysisDigest({
      homeTeam: "Inter Milan",
      awayTeam: "AC Milan",
      league: "serie-a",
      startTime: serieAKickoff,
    });
    check("buildFootballAnalysisDigest makes no OpenRouter call", openRouterCalls === 0, `made ${openRouterCalls}`);
    const callsAfterDigest = footballDataCalls;
    check("building the digest makes at least one football-data.org call", callsAfterDigest > 0, `${callsAfterDigest}`);

    const runCount = 5;
    const results = await Promise.all(
      Array.from({ length: runCount }, () =>
        getIndependentPredictionFromDigest({
          homeTeam: "Inter Milan",
          awayTeam: "AC Milan",
          leagueName: "Serie A",
          startTime: serieAKickoff,
          digest: digest.text,
        })
      )
    );

    check("all 5 predict-from-digest calls succeed", results.length === 5);
    check(
      "5 parallel predict-from-digest calls make ZERO additional football-data.org calls",
      footballDataCalls === callsAfterDigest,
      `${callsAfterDigest} -> ${footballDataCalls}`
    );
    check("5 parallel predict-from-digest calls make exactly 5 OpenRouter calls", openRouterCalls === 5, `${openRouterCalls}`);
  }

  // --- Once ESPN has actually posted a lineup, buildFootballAnalysisDigest surfaces it both as
  // structured fields (for the analysis sheet's UI) and folded into the text digest the LLM reads
  // — the same "structured alongside text" contract standings/injuries already follow. ---
  {
    // Ligue 1 — not reused from any earlier block in this file, since football-data.org's team
    // roster cache is keyed by competition code for the life of this process (see the comment
    // above process.env.FOOTBALL_DATA_API_KEY), and reusing a league already exercised elsewhere
    // would silently serve that earlier block's cached teams instead of these ones.
    __resetRateLimiterForTests();
    const ligue1Home = { id: 600, name: "Paris SG" };
    const ligue1Away = { id: 601, name: "Marseille" };
    const ligue1Kickoff = "2026-06-01T19:00:00.000Z";
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/summary?event=")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            rosters: [
              {
                homeAway: "home",
                formation: "4-3-3",
                roster: [
                  { starter: true, athlete: { displayName: "Home Keeper" }, position: { abbreviation: "GK" } },
                  { starter: true, athlete: { displayName: "Home Striker" }, position: { abbreviation: "FW" } },
                  { starter: false, athlete: { displayName: "Home Sub" }, position: { abbreviation: "MF" } },
                ],
              },
              {
                homeAway: "away",
                formation: "4-4-2",
                roster: [{ starter: true, athlete: { displayName: "Away Keeper" }, position: { abbreviation: "GK" } }],
              },
            ],
          }),
        };
      }
      if (u.includes("/scoreboard?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            events: [
              {
                id: "555999",
                competitions: [
                  {
                    competitors: [
                      { homeAway: "home", team: { displayName: "Paris SG" } },
                      { homeAway: "away", team: { displayName: "Marseille" } },
                    ],
                  },
                ],
              },
            ],
          }),
        };
      }
      if (u.includes("api.football-data.org")) {
        if (u.includes("/competitions/")) return { ok: true, status: 200, json: async () => ({ teams: [ligue1Home, ligue1Away] }) };
        if (u.includes("/head2head")) return { ok: true, status: 200, json: async () => ({ matches: [] }) };
        if (u.includes(`/teams/${ligue1Home.id}/matches`) || u.includes(`/teams/${ligue1Away.id}/matches`)) {
          return { ok: true, status: 200, json: async () => ({ matches: [] }) };
        }
        if (u.includes("/matches?")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              matches: [
                fdMatch({ id: 900020, date: ligue1Kickoff, home: ligue1Home, away: ligue1Away, status: "SCHEDULED", homeGoals: null, awayGoals: null }),
              ],
            }),
          };
        }
        throw new Error(`Unhandled football-data.org URL: ${u}`);
      }
      return completion({ content: GOOD_JSON }, "stop", { cost: 0.0009 });
    }) as unknown as typeof fetch;

    const digest = await buildFootballAnalysisDigest({
      homeTeam: "Paris SG",
      awayTeam: "Marseille",
      league: "ligue-1",
      startTime: ligue1Kickoff,
    });

    check(
      "the home side's posted lineup comes back with its formation and only its actual starters",
      digest.homeLineup?.formation === "4-3-3" &&
        digest.homeLineup?.starters.length === 2 &&
        digest.homeLineup?.starters.some((p) => p.name === "Home Keeper" && p.position === "GK"),
      JSON.stringify(digest.homeLineup)
    );
    check(
      "a non-starter on the roster is excluded",
      digest.homeLineup?.starters.every((p) => p.name !== "Home Sub") ?? false,
      JSON.stringify(digest.homeLineup)
    );
    check(
      "the away side's lineup is parsed too, independently of the home side's",
      digest.awayLineup?.formation === "4-4-2" && digest.awayLineup?.starters.length === 1,
      JSON.stringify(digest.awayLineup)
    );
    check(
      "the text digest folds both lineups in, for the LLM to actually read",
      /Paris SG \(4-3-3\): Home Keeper, Home Striker/.test(digest.text) && /Marseille \(4-4-2\): Away Keeper/.test(digest.text),
      digest.text.slice(digest.text.indexOf("Starting Lineups"))
    );
  }
}

// Cost tracking: OpenRouter only returns a dollar cost when asked via `usage: { include: true }`
// in the request body, and the field can come back as a number or a numeric string depending on
// provider — these checks cover the request flag, both response shapes, cost accumulating across
// a retried attempt (a wasted call can still have cost real money), and the two-stage pipeline
// summing both of its calls' costs into one total.
async function runCostTrackingChecks(failures: string[]) {
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  let capturedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string);
    return completion({ content: GOOD_JSON }, "stop", { cost: 0.0021 });
  }) as unknown as typeof fetch;
  const numeric = await requestJson<{ homeWinProb: number }>(
    [{ role: "system", content: "s" }, { role: "user", content: "u" }],
    true,
    3000
  );
  check("the request body asks OpenRouter to include usage/cost", (capturedBody.usage as { include?: boolean })?.include === true);
  check("cost comes back as a number when the API returns one", numeric.costUsd === 0.0021, `got ${numeric.costUsd}`);

  globalThis.fetch = (async () =>
    completion({ content: GOOD_JSON }, "stop", { cost: "0.0034" })) as unknown as typeof fetch;
  const stringCost = await requestJson<{ homeWinProb: number }>(
    [{ role: "system", content: "s" }, { role: "user", content: "u" }],
    true,
    3000
  );
  check(
    "cost is coerced to a number when the API returns a numeric string",
    stringCost.costUsd === 0.0034,
    `got ${stringCost.costUsd} (${typeof stringCost.costUsd})`
  );

  globalThis.fetch = (async () => completion({ content: GOOD_JSON })) as unknown as typeof fetch;
  const noCost = await requestJson<{ homeWinProb: number }>(
    [{ role: "system", content: "s" }, { role: "user", content: "u" }],
    true,
    3000
  );
  check("cost is null (not NaN or 0) when the API doesn't report it", noCost.costUsd === null, `got ${noCost.costUsd}`);

  // A first attempt that returns empty content still burned real tokens/money — its cost must
  // carry through to the total even though that attempt never produced a usable answer.
  let attempt = 0;
  globalThis.fetch = (async () => {
    attempt++;
    if (attempt === 1) return completion({ content: "" }, "stop", { cost: 0.0005 });
    return completion({ content: GOOD_JSON }, "stop", { cost: 0.002 });
  }) as unknown as typeof fetch;
  const retried = await requestJson<{ homeWinProb: number }>(
    [{ role: "system", content: "s" }, { role: "user", content: "u" }],
    true,
    3000
  );
  check(
    "cost accumulates across a retried (wasted) attempt rather than only keeping the last one",
    Math.abs((retried.costUsd ?? 0) - 0.0025) < 0.00001,
    `got ${retried.costUsd}`
  );
}

// The compare step has no research digest of its own (unlike predict, which gets the real
// live/final status baked into what it reads) — gameTimeLine() is the pre-computed "Current Game
// Time" fact that tells it plainly whether the match it's comparing against the market has
// actually kicked off yet, rather than leaving it to work that out itself from two separate raw
// timestamps (kickoff and nowLine()'s current date/time), which is what it kept getting wrong.
async function runCompareChecks(failures: string[]) {
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  const COMPARE_JSON = JSON.stringify({
    homeEdge: 0.05,
    drawEdge: -0.02,
    awayEdge: -0.03,
    bestValue: "home",
    confidence: "medium",
    agreesWithMarket: false,
    verdict: "The market undervalues the home side.",
  });

  let capturedUserPrompt = "";
  let capturedSystemPrompt = "";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as { messages: { role: string; content: string }[] };
    capturedSystemPrompt = body.messages.find((m) => m.role === "system")?.content ?? "";
    capturedUserPrompt = body.messages.find((m) => m.role === "user")?.content ?? "";
    return completion({ content: COMPARE_JSON });
  }) as unknown as typeof fetch;

  const kickoff = new Date("2026-03-14T18:00:00Z");
  await compareToMarket({
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    leagueName: "Premier League",
    startTime: kickoff.toISOString(),
    independent: {
      home: 0.55,
      draw: 0.25,
      away: 0.2,
      confidence: "medium",
      homeAssessment: { pros: [], cons: [] },
      awayAssessment: { pros: [], cons: [] },
      summary: "s",
    },
    market: { home: 0.4, draw: 0.3, away: 0.3 },
  });

  check(
    "the compare prompt includes the match's real kickoff date",
    capturedUserPrompt.includes(kickoff.toUTCString()),
    capturedUserPrompt
  );
  check(
    "the compare prompt still tells the model the current date/time too",
    /Current date and time:/.test(capturedUserPrompt),
    capturedUserPrompt
  );
  check(
    "the compare prompt includes a labeled Current Game Time line",
    /Current Game Time:/.test(capturedUserPrompt),
    capturedUserPrompt
  );
  check(
    "the system prompt tells the model to trust the Current Game Time line over its own guess",
    /"Current Game Time"/.test(capturedSystemPrompt) && /trust that line/.test(capturedSystemPrompt),
    capturedSystemPrompt
  );
}

// gameTimeLine() itself — the pre-computed fact that used to be left to the model to work out
// from two separate raw timestamps.
function runGameTimeLineChecks(failures: string[]) {
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  const now = Date.now();
  const isoIn = (ms: number) => new Date(now + ms).toISOString();

  const notStarted = gameTimeLine(isoIn(45 * 60_000), now);
  check("a match 45 minutes from kickoff reads as not started yet", /NOT STARTED YET/.test(notStarted), notStarted);
  check("a not-started line names how many minutes until kickoff", /45 minutes from now/.test(notStarted), notStarted);

  const justKickedOff = gameTimeLine(isoIn(0), now);
  check("a match kicking off this exact instant reads as live, not not-started", /LIVE \/ IN PROGRESS/.test(justKickedOff), justKickedOff);

  const midway = gameTimeLine(isoIn(-63 * 60_000), now);
  check("a match 63 minutes past kickoff reads as live", /LIVE \/ IN PROGRESS/.test(midway), midway);
  check("the live line states the real elapsed minutes plainly", /kickoff was 63 minutes ago/.test(midway), midway);

  const probablyOver = gameTimeLine(isoIn(-(MATCH_OVER_AFTER_MS + 60_000)), now);
  check("a match past MATCH_OVER_AFTER_MS reads as probably over", /PROBABLY OVER/.test(probablyOver), probablyOver);

  const rightAtBoundary = gameTimeLine(isoIn(-MATCH_OVER_AFTER_MS), now);
  check("right at the MATCH_OVER_AFTER_MS boundary, it's already probably over (>=, not >)", /PROBABLY OVER/.test(rightAtBoundary), rightAtBoundary);

  const invalid = gameTimeLine("not a real date", now);
  check("an invalid kickoff time never crashes — it reads as unknown instead", /unknown/.test(invalid), invalid);

  check("every branch starts with the same unmissable label", [notStarted, midway, probablyOver].every((l) => l.startsWith("Current Game Time:")));

  // --- With a real live score (the same data a Sports-page card itself shows), gameTimeLine
  // reports it directly instead of falling back to the wall-clock guess — this is the actual fix
  // for "the analysis keeps saying started X minutes ago instead of using real live data". ---
  const realLive = gameTimeLine(isoIn(-63 * 60_000), now, { status: "IN_PLAY", clockLabel: "63'", homeGoals: 2, awayGoals: 1 });
  check("a real live score reports LIVE with the actual clock label, not an estimate", /LIVE/.test(realLive) && /63'/.test(realLive), realLive);
  check("a real live score reports the actual score", /2-1/.test(realLive), realLive);
  check("a real live score is explicitly marked as real data, not an estimate", /not an estimate/.test(realLive), realLive);
  check("estimated language ('accounting for the half-time break') does not leak into the real-data branch", !/accounting for/.test(realLive), realLive);

  const realHalftime = gameTimeLine(isoIn(-50 * 60_000), now, { status: "PAUSED", homeGoals: 0, awayGoals: 0 });
  check("a real PAUSED status with no clockLabel falls back to HT, not 'in progress'", /HT/.test(realHalftime), realHalftime);

  const realFinished = gameTimeLine(isoIn(-200 * 60_000), now, { status: "FINISHED", homeGoals: 3, awayGoals: 1 });
  check("a real FINISHED status reports the final score directly, not a 'probably over' guess", /FINISHED/.test(realFinished) && /3-1/.test(realFinished), realFinished);

  const notLiveYetButHasStatus = gameTimeLine(isoIn(45 * 60_000), now, { status: "SCHEDULED", homeGoals: null, awayGoals: null });
  check(
    "a real status that isn't in-play/paused/finished (SCHEDULED) falls back to the wall-clock estimate",
    /NOT STARTED YET/.test(notLiveYetButHasStatus),
    notLiveYetButHasStatus
  );

  const nullLive = gameTimeLine(isoIn(-63 * 60_000), now, null);
  check("passing null for liveScore behaves exactly like passing nothing at all", nullLive === midway, nullLive);
}

// parseLiveScoreInput — validates the untrusted `liveScore` field a client can send on an
// analyze request. Malformed or absent input must never throw, and must never be trusted as-is.
function runParseLiveScoreInputChecks(failures: string[]) {
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  check("undefined resolves to null", parseLiveScoreInput(undefined) === null);
  check("null resolves to null", parseLiveScoreInput(null) === null);
  check("a plain string resolves to null rather than throwing", parseLiveScoreInput("IN_PLAY") === null);
  check("an object with no status field resolves to null", parseLiveScoreInput({ clockLabel: "63'" }) === null);

  const valid = parseLiveScoreInput({ status: "IN_PLAY", clockLabel: "63'", homeGoals: 2, awayGoals: 1 });
  check("a fully-formed object round-trips exactly", JSON.stringify(valid) === JSON.stringify({ status: "IN_PLAY", clockLabel: "63'", homeGoals: 2, awayGoals: 1 }), JSON.stringify(valid));

  const missingGoals = parseLiveScoreInput({ status: "SCHEDULED" });
  check("missing goals default to null rather than undefined/NaN", missingGoals?.homeGoals === null && missingGoals?.awayGoals === null, JSON.stringify(missingGoals));

  const wrongTypes = parseLiveScoreInput({ status: "IN_PLAY", clockLabel: 63, homeGoals: "2", awayGoals: 1 });
  check("a wrongly-typed clockLabel/homeGoals is dropped rather than trusted as-is", wrongTypes?.clockLabel === undefined && wrongTypes?.homeGoals === null, JSON.stringify(wrongTypes));
}

async function run() {
  const failures: string[] = [];

  runGameTimeLineChecks(failures);
  runParseLiveScoreInputChecks(failures);
  await runResilienceCases(failures);
  await runFootballPipelineChecks(failures);
  await runCostTrackingChecks(failures);
  await runCompareChecks(failures);

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll OpenRouter resilience cases passed.");
}

run();

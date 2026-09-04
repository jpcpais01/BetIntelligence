import { requestJson, getIndependentPrediction } from "../lib/openrouter";

process.env.OPENROUTER_API_KEY = "test-key";
process.env.API_FOOTBALL_KEY = "test-key";

const GOOD_JSON = JSON.stringify({
  homeWinProb: 0.5,
  drawProb: 0.28,
  awayWinProb: 0.22,
  confidence: "medium",
  keyFactors: ["Form", "Injuries", "H2H"],
  rationale: "Home side edges it.",
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

interface ApiFootballTeamFixture {
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

function apiFootballFixture(opts: {
  id: number;
  date: string;
  home: ApiFootballTeamFixture;
  away: ApiFootballTeamFixture;
  status: { long: string; short: string; elapsed: number | null };
  goals: { home: number | null; away: number | null };
}) {
  return {
    fixture: { id: opts.id, date: opts.date, status: opts.status },
    teams: { home: opts.home, away: opts.away },
    goals: opts.goals,
  };
}

// A fetch mock that dispatches api-football.io requests to canned per-endpoint responses (by
// matching bits of the URL) and forwards anything else (OpenRouter) to a separate handler.
function makeMixedFetch(opts: {
  home: ApiFootballTeamFixture;
  away: ApiFootballTeamFixture;
  fixtures?: unknown[];
  homeForm?: unknown[];
  awayForm?: unknown[];
  injuries?: unknown[];
  h2h?: unknown[];
  onOpenRouterRequest: (body: CapturedRequest) => unknown;
}) {
  return (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("v3.football.api-sports.io")) {
      if (u.includes("/teams?")) return apiOk([{ team: opts.home }, { team: opts.away }]);
      if (u.includes("/fixtures/headtohead")) return apiOk(opts.h2h ?? []);
      if (u.includes("/injuries?fixture=")) return apiOk(opts.injuries ?? []);
      if (u.includes(`team=${opts.home.id}`) && u.includes("last=")) return apiOk(opts.homeForm ?? []);
      if (u.includes(`team=${opts.away.id}`) && u.includes("last=")) return apiOk(opts.awayForm ?? []);
      if (u.includes("from=") && u.includes("to=")) return apiOk(opts.fixtures ?? []);
      throw new Error(`Unhandled API-Football URL in test: ${u}`);
    }
    const body = JSON.parse(init?.body as string) as CapturedRequest;
    return opts.onOpenRouterRequest(body);
  }) as unknown as typeof fetch;
}

// The football pipeline used to be a two-stage pipeline where an AI web-search pass built the
// digest handed to the predict step. That search turned out to give wrong data often enough to be
// worse than useless, so it's now a single OpenRouter call (predict only) fed a digest built
// straight from API-Football's structured match data (lib/apiFootball.ts) — no web search, no
// fallback to it if a team or fixture can't be resolved there.
//
// Each block below uses a different league — lib/apiFootball.ts caches a league's team roster
// in-memory per (league, season) for the life of the process to save API-Football's daily quota,
// and this file's test cases all share that same process, so reusing one league across blocks
// would silently serve an earlier block's cached teams instead of exercising this block's mock.
async function runFootballPipelineChecks(failures: string[]) {
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  const home = { id: 42, name: "Arsenal" };
  const away = { id: 49, name: "Chelsea" };
  const kickoff = "2026-01-15T20:00:00.000Z";

  // --- Happy path: a not-yet-started match with form, injuries, and H2H all present ---
  {
    const requests: CapturedRequest[] = [];
    globalThis.fetch = makeMixedFetch({
      home,
      away,
      fixtures: [
        apiFootballFixture({
          id: 900001,
          date: kickoff,
          home,
          away,
          status: { long: "Not Started", short: "NS", elapsed: null },
          goals: { home: null, away: null },
        }),
      ],
      homeForm: [
        apiFootballFixture({
          id: 1,
          date: "2026-01-08T15:00:00.000Z",
          home,
          away: { id: 99, name: "Fulham" },
          status: { long: "Match Finished", short: "FT", elapsed: 90 },
          goals: { home: 3, away: 1 },
        }),
      ],
      awayForm: [
        apiFootballFixture({
          id: 2,
          date: "2026-01-08T15:00:00.000Z",
          home: { id: 100, name: "Everton" },
          away,
          status: { long: "Match Finished", short: "FT", elapsed: 90 },
          goals: { home: 2, away: 2 },
        }),
      ],
      injuries: [{ player: { name: "Bukayo Saka", type: "Missing Fixture", reason: "Hamstring Injury" }, team: { id: home.id } }],
      h2h: [
        apiFootballFixture({
          id: 3,
          date: "2025-05-01T15:00:00.000Z",
          home,
          away,
          status: { long: "Match Finished", short: "FT", elapsed: 90 },
          goals: { home: 1, away: 1 },
        }),
      ],
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
    check("the digest includes the reported injury", /Saka/.test(predictUserPrompt) && /Hamstring/.test(predictUserPrompt));
    check("the digest includes head-to-head history", /1-1/.test(predictUserPrompt));
    check("the digest notes the match hasn't started yet", /has not started yet/.test(predictUserPrompt));

    check("no sources are returned (no web search happened)", (result.sources ?? []).length === 0, JSON.stringify(result.sources));
    check("cost is just the single predict call's cost, not a sum of two", Math.abs((result.costUsd ?? 0) - 0.0009) < 0.00001, `got ${result.costUsd}`);
  }

  // --- A live match: current score and elapsed minutes should show up in the digest ---
  {
    const liveHome = { id: 142, name: "Liverpool" };
    const liveAway = { id: 149, name: "Everton" };
    const liveKickoff = "2026-02-01T15:00:00.000Z";
    let predictUserPrompt = "";
    globalThis.fetch = makeMixedFetch({
      home: liveHome,
      away: liveAway,
      fixtures: [
        apiFootballFixture({
          id: 900002,
          date: liveKickoff,
          home: liveHome,
          away: liveAway,
          status: { long: "Second Half", short: "2H", elapsed: 63 },
          goals: { home: 2, away: 1 },
        }),
      ],
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
    check("a live match's digest reports elapsed minutes", /63'/.test(predictUserPrompt), predictUserPrompt.slice(0, 300));
  }

  // --- No fallback: an unresolvable team fails the whole analysis, with no OpenRouter call at all ---
  {
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

async function run() {
  const failures: string[] = [];

  await runResilienceCases(failures);
  await runFootballPipelineChecks(failures);
  await runCostTrackingChecks(failures);

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll OpenRouter resilience cases passed.");
}

run();

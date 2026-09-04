import { requestJson, getIndependentPrediction } from "../lib/openrouter";
import { __resetRateLimiterForTests } from "../lib/footballData";

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

    check("no sources are returned (no web search happened)", (result.sources ?? []).length === 0, JSON.stringify(result.sources));
    check("cost is just the single predict call's cost, not a sum of two", Math.abs((result.costUsd ?? 0) - 0.0009) < 0.00001, `got ${result.costUsd}`);
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

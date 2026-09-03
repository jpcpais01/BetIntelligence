import { requestJson, getIndependentPrediction } from "../lib/openrouter";

process.env.OPENROUTER_API_KEY = "test-key";

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

// getIndependentPrediction now runs a two-stage pipeline: a research call (web access, produces
// a prose digest) followed by a predict call (no web access, only ever sees that digest). These
// checks verify the wiring itself — the separation is the actual defense against the model
// anchoring its "independent" read on odds its own web search happened to surface.
async function runTwoStageWiringChecks(failures: string[]) {
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  const DIGEST = "Form: Arsenal have won 4 of their last 5 league matches. Injuries: Chelsea missing two starting defenders.";
  const requests: CapturedRequest[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as CapturedRequest;
    requests.push(body);
    if (requests.length === 1) {
      return completion(
        {
          content: DIGEST,
          annotations: [{ type: "url_citation", url_citation: { url: "https://news.example/1", title: "Match preview" } }],
        },
        "stop",
        { cost: 0.0018 }
      );
    }
    return completion({ content: GOOD_JSON }, "stop", { cost: 0.0009 });
  }) as unknown as typeof fetch;

  const result = await getIndependentPrediction({
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    leagueName: "Premier League",
    startTime: new Date().toISOString(),
  });

  check("makes exactly two calls (research, then predict)", requests.length === 2, `made ${requests.length}`);

  const researchSystemPrompt = requests[0]?.messages.find((m) => m.role === "system")?.content ?? "";
  const predictSystemPrompt = requests[1]?.messages.find((m) => m.role === "system")?.content ?? "";

  check("the research call requests web search (:online)", requests[0]?.model.endsWith(":online") ?? false, requests[0]?.model);
  check("the predict call does NOT request web search", requests[1]?.model.endsWith(":online") === false, requests[1]?.model);

  check(
    "the research system prompt forbids ever mentioning odds/prices",
    /never mention/i.test(researchSystemPrompt) && /odds/i.test(researchSystemPrompt),
    researchSystemPrompt.slice(0, 120)
  );
  check(
    "the predict system prompt also guards against odds leaking through anyway",
    /must not/i.test(predictSystemPrompt) && /disregard/i.test(predictSystemPrompt)
  );

  const predictUserPrompt = requests[1]?.messages.find((m) => m.role === "user")?.content ?? "";
  check(
    "stage 1's digest text is what stage 2 actually reasons over",
    predictUserPrompt.includes(DIGEST),
    "digest missing from the predict call's prompt"
  );

  check(
    "the returned sources are the research call's citations",
    result.sources?.length === 1 && result.sources[0].url === "https://news.example/1",
    JSON.stringify(result.sources)
  );

  check(
    "the returned cost is the sum of the research and predict calls",
    Math.abs((result.costUsd ?? 0) - 0.0027) < 0.00001,
    `got ${result.costUsd}`
  );
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
  await runTwoStageWiringChecks(failures);
  await runCostTrackingChecks(failures);

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll OpenRouter resilience cases passed.");
}

run();

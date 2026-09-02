import { getIndependentPrediction } from "../lib/openrouter";

process.env.OPENROUTER_API_KEY = "test-key";

const GOOD_JSON = JSON.stringify({
  homeWinProb: 0.5,
  drawProb: 0.28,
  awayWinProb: 0.22,
  confidence: "medium",
  keyFactors: ["Form", "Injuries", "H2H"],
  rationale: "Home side edges it.",
});

function completion(message: unknown, finishReason: string | null = "stop") {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ choices: [{ message, finish_reason: finishReason }] }),
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

async function run() {
  const failures: string[] = [];

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
      const result = await getIndependentPrediction({
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        leagueName: "Premier League",
        startTime: new Date().toISOString(),
      });
      sources = result.sources?.length ?? 0;
      const sum = result.home + result.draw + result.away;
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

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll OpenRouter resilience cases passed.");
}

run();

import { getIndependentMarketPrediction, compareMarketToOdds } from "../lib/openrouterMarkets";
import type { MarketPrediction } from "../lib/types";

process.env.OPENROUTER_API_KEY = "test-key";

// A 6-way market (more realistic than football's fixed 3-outcome shape) — this is exactly the
// case the Discover feed's "several options" markets exercise, and the one place the shared
// alignment logic (resolveLabel/alignByLabel in lib/openrouterMarkets.ts) actually has to work
// for correctness, not just avoid crashing.
const LABELS = ["Brazil", "France", "Argentina", "England", "Spain", "Other"];

function completion(content: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }] }),
    text: async () => "",
  };
}

function mockFetchOnce(body: unknown) {
  globalThis.fetch = (async () => completion(JSON.stringify(body))) as unknown as typeof fetch;
}

// Captures the max_tokens and model actually sent in the request body, so the token-budget-
// scales-with-outcome-count fix and the user-selectable-model feature can both be checked
// directly rather than trusted on faith.
let lastRequestMaxTokens: number | null = null;
let lastRequestModel: string | null = null;
function mockFetchCapturing(body: unknown) {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const parsedBody = init?.body ? JSON.parse(init.body as string) : {};
    lastRequestMaxTokens = typeof parsedBody.max_tokens === "number" ? parsedBody.max_tokens : null;
    lastRequestModel = typeof parsedBody.model === "string" ? parsedBody.model : null;
    return completion(JSON.stringify(body));
  }) as unknown as typeof fetch;
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // 1. Outcomes returned out of order, with incidental whitespace/case drift — every original
  //    label must still come back, in the ORIGINAL order, summing to ~1.
  mockFetchOnce({
    outcomes: [
      { label: "other", probability: 0.1 },
      { label: "Argentina ", probability: 0.3 },
      { label: "BRAZIL", probability: 0.25 },
      { label: "France", probability: 0.15 },
      { label: "England", probability: 0.1 },
      { label: "Spain", probability: 0.1 },
    ],
    confidence: "high",
    keyFactors: ["Squad depth", "Recent form", "Draw path"],
    rationale: "Argentina and Brazil lead a competitive field.",
  });
  const p1 = await getIndependentMarketPrediction({
    title: "2026 World Cup Winner",
    category: "Sports",
    endDate: new Date(Date.now() + 200 * 86_400_000).toISOString(),
    outcomeLabels: LABELS,
  });
  check(
    "predict: preserves original label order",
    JSON.stringify(p1.outcomes.map((o) => o.label)) === JSON.stringify(LABELS)
  );
  check(
    "predict: case/whitespace-drifted labels aligned correctly",
    Math.abs(p1.outcomes.find((o) => o.label === "Argentina")!.probability - 0.3) < 0.01 &&
      Math.abs(p1.outcomes.find((o) => o.label === "Brazil")!.probability - 0.25) < 0.01
  );
  const sum1 = p1.outcomes.reduce((s, o) => s + o.probability, 0);
  check("predict: probabilities sum to ~1", Math.abs(sum1 - 1) < 0.001, `got ${sum1}`);

  // 2. AI drops an outcome entirely — it must still appear in the output (not silently vanish
  //    from the UI), and the remaining probabilities must still sum to ~1 after renormalizing.
  mockFetchOnce({
    outcomes: [
      { label: "Brazil", probability: 0.4 },
      { label: "France", probability: 0.3 },
      { label: "Argentina", probability: 0.3 },
      // England, Spain, Other omitted entirely.
    ],
    confidence: "medium",
    keyFactors: ["Top three dominate"],
    rationale: "Field narrows to three realistic contenders.",
  });
  const p2 = await getIndependentMarketPrediction({
    title: "2026 World Cup Winner",
    category: "Sports",
    endDate: new Date(Date.now() + 200 * 86_400_000).toISOString(),
    outcomeLabels: LABELS,
  });
  check("predict: omitted outcome still present in output", p2.outcomes.some((o) => o.label === "Other"));
  check("predict: omitted outcome defaults to 0 before renormalizing", (p2.outcomes.find((o) => o.label === "Other")?.probability ?? -1) === 0);
  const sum2 = p2.outcomes.reduce((s, o) => s + o.probability, 0);
  check("predict: still sums to ~1 after an omission", Math.abs(sum2 - 1) < 0.001, `got ${sum2}`);

  // 3. Compare step: bestValue paraphrased with extra text — must still resolve to the exact
  //    known label (this is the bug: bestValue used to be matched with exact-string-equality
  //    only, while every other field already tolerated this kind of drift).
  const independent: MarketPrediction = {
    outcomes: LABELS.map((label, i) => ({ label, probability: i === 0 ? 0.5 : 0.1 })),
    confidence: "high",
    keyFactors: [],
    rationale: "",
  };
  mockFetchOnce({
    edges: [
      { label: "brazil", edge: 0.15 },
      { label: "France", edge: -0.02 },
      { label: "Argentina", edge: 0.01 },
      { label: "England", edge: -0.05 },
      { label: "Spain", edge: -0.03 },
      { label: "Other", edge: -0.06 },
    ],
    bestValue: "Brazil national team", // paraphrased, not an exact match
    confidence: "high",
    agreesWithMarket: false,
    verdict: "Brazil is undervalued relative to squad quality.",
  });
  const c1 = await compareMarketToOdds({
    title: "2026 World Cup Winner",
    category: "Sports",
    independent,
    market: LABELS.map((label, i) => ({ label, price: i === 0 ? 0.35 : 0.13 })),
  });
  check("compare: paraphrased bestValue resolves to the exact known label", c1.bestValue === "Brazil", `got ${c1.bestValue}`);
  check("compare: edges cover every original label", JSON.stringify(c1.edges.map((e) => e.label)) === JSON.stringify(LABELS));

  // 4. Compare step: bestValue that matches nothing at all must resolve to null, not throw and
  //    not silently attach itself to some unrelated outcome.
  mockFetchOnce({
    edges: LABELS.map((label) => ({ label, edge: 0 })),
    bestValue: "Portugal", // not one of the offered outcomes at all
    confidence: "low",
    agreesWithMarket: true,
    verdict: "No real edge found.",
  });
  const c2 = await compareMarketToOdds({
    title: "2026 World Cup Winner",
    category: "Sports",
    independent,
    market: LABELS.map((label) => ({ label, price: 1 / LABELS.length })),
  });
  check("compare: unmatchable bestValue resolves to null", c2.bestValue === null, `got ${c2.bestValue}`);

  // 5. Token budget must actually scale with outcome count — this is the fix for the real bug
  //    reported in production ("AI was unable to return a usable JSON" happening on every
  //    attempt for multi-outcome markets): a flat budget copied from football's fixed 3-outcome
  //    shape meant the model truncated mid-JSON on markets with several outcomes, and because a
  //    retry resends the identical prompt at the identical budget, every attempt truncated
  //    identically — a guaranteed failure, not an occasional one.
  mockFetchCapturing({
    outcomes: [
      { label: "Yes", probability: 0.6 },
      { label: "No", probability: 0.4 },
    ],
    confidence: "medium",
    keyFactors: ["A"],
    rationale: "r",
  });
  await getIndependentMarketPrediction({
    title: "Binary market",
    category: "Business",
    endDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    outcomeLabels: ["Yes", "No"],
  });
  const binaryPredictTokens = lastRequestMaxTokens;

  const manyLabels = ["Brazil", "France", "Argentina", "England", "Spain", "Germany", "Italy", "Other"];
  mockFetchCapturing({
    outcomes: manyLabels.map((label) => ({ label, probability: 1 / manyLabels.length })),
    confidence: "medium",
    keyFactors: ["A", "B", "C"],
    rationale: "r",
  });
  await getIndependentMarketPrediction({
    title: "8-way market",
    category: "Sports",
    endDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    outcomeLabels: manyLabels,
  });
  const eightWayPredictTokens = lastRequestMaxTokens;

  check(
    "predict: token budget for an 8-outcome market is meaningfully larger than for a binary one",
    binaryPredictTokens !== null && eightWayPredictTokens !== null && eightWayPredictTokens > binaryPredictTokens + 1000,
    `binary=${binaryPredictTokens}, 8-way=${eightWayPredictTokens}`
  );
  check(
    "predict: binary market budget is still at least as generous as football's fixed 3000",
    (binaryPredictTokens ?? 0) >= 3000,
    `got ${binaryPredictTokens}`
  );

  mockFetchCapturing({
    edges: manyLabels.map((label) => ({ label, edge: 0 })),
    bestValue: null,
    confidence: "medium",
    agreesWithMarket: true,
    verdict: "v",
  });
  await compareMarketToOdds({
    title: "8-way market",
    category: "Sports",
    independent: { outcomes: manyLabels.map((label) => ({ label, probability: 1 / manyLabels.length })), confidence: "medium", keyFactors: [], rationale: "" },
    market: manyLabels.map((label) => ({ label, price: 1 / manyLabels.length })),
  });
  check(
    "compare: token budget for an 8-outcome market exceeds football's fixed 2000",
    (lastRequestMaxTokens ?? 0) > 2000,
    `got ${lastRequestMaxTokens}`
  );

  // A caller-supplied model id (e.g. the user picking GLM instead of DeepSeek) must actually
  // reach both stages of the request — the research call (:online) and the predict call (no
  // :online, since that stage has no web access of its own).
  {
    const models: string[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      models.push(body.model);
      if (models.length === 1) return completion("Some research digest text, no odds mentioned.");
      return completion(
        JSON.stringify({
          outcomes: [
            { label: "Yes", probability: 0.5 },
            { label: "No", probability: 0.5 },
          ],
          confidence: "medium",
          keyFactors: ["A"],
          rationale: "r",
        })
      );
    }) as unknown as typeof fetch;
    await getIndependentMarketPrediction({
      title: "Binary market",
      category: "Business",
      endDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      outcomeLabels: ["Yes", "No"],
      model: "z-ai/glm-5.3-flash",
    });
    check(
      "predict: the research call carries the chosen model with :online",
      models[0] === "z-ai/glm-5.3-flash:online",
      `got ${models[0]}`
    );
    check(
      "predict: the predict call carries the chosen model WITHOUT :online (no web access at that stage)",
      models[1] === "z-ai/glm-5.3-flash",
      `got ${models[1]}`
    );
  }

  // Omitting the model (an older caller, or a stale client) must still work rather than send
  // "undefined" to OpenRouter — it should fall back to the default model.
  mockFetchCapturing({
    edges: [
      { label: "Yes", edge: 0 },
      { label: "No", edge: 0 },
    ],
    bestValue: null,
    confidence: "medium",
    agreesWithMarket: true,
    verdict: "v",
  });
  await compareMarketToOdds({
    title: "Binary market",
    category: "Business",
    independent: {
      outcomes: [
        { label: "Yes", probability: 0.5 },
        { label: "No", probability: 0.5 },
      ],
      confidence: "medium",
      keyFactors: [],
      rationale: "",
    },
    market: [
      { label: "Yes", price: 0.5 },
      { label: "No", price: 0.5 },
    ],
  });
  check(
    "compare: an omitted model falls back to a real default rather than sending undefined",
    typeof lastRequestModel === "string" && lastRequestModel.length > 0,
    `got ${lastRequestModel}`
  );

  // getIndependentMarketPrediction runs a two-stage pipeline, same as football's
  // getIndependentPrediction: a research call (web access, produces a prose digest) followed by
  // a predict call (no web access, only ever sees that digest). A Discover market's title is
  // itself often a real Polymarket question, so the research call's own search is quite likely to
  // surface that market's own price — these checks verify the separation that protects against it.
  {
    const DIGEST = "Recent polling shows a tight race. No major shifts in the last week.";
    interface CapturedRequest {
      model: string;
      messages: { role: string; content: string }[];
    }
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as CapturedRequest;
      requests.push(body);
      if (requests.length === 1) return completion(DIGEST);
      return completion(
        JSON.stringify({
          outcomes: [
            { label: "Yes", probability: 0.5 },
            { label: "No", probability: 0.5 },
          ],
          confidence: "medium",
          keyFactors: ["A"],
          rationale: "r",
        })
      );
    }) as unknown as typeof fetch;

    await getIndependentMarketPrediction({
      title: "Binary market",
      category: "Business",
      endDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      outcomeLabels: ["Yes", "No"],
    });

    check("makes exactly two calls (research, then predict)", requests.length === 2, `made ${requests.length}`);

    const researchSystemPrompt = requests[0]?.messages.find((m) => m.role === "system")?.content ?? "";
    const predictSystemPrompt = requests[1]?.messages.find((m) => m.role === "system")?.content ?? "";

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
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll multi-outcome market analysis cases passed.");
}

run();

import { requestJson, requestText, clampConfidence, nowLine, withNow } from "./openrouter";
import type { MarketComparison, MarketOutcome, MarketPrediction, OutcomeProbability } from "./types";

// Football's analysis prompts (lib/openrouter.ts) always have exactly 3 fixed-length outcomes
// (home/draw/away) and a flat token budget works fine there. Discover markets can have anywhere
// from 2 to 8 outcomes, often with much longer labels (candidate or team names) — reusing that
// same flat budget here meant the model would truncate mid-JSON on any market with several
// outcomes (finish_reason "length"), and since a retry resends the SAME prompt with the SAME
// budget, it truncated identically every single attempt — a guaranteed "failed after 3 attempts"
// for exactly the markets this feature exists to cover. Budget now scales with how much the
// model actually has to say: one {label, probability} pair per outcome, plus edges in the
// compare step, plus headroom for :online web-search reasoning before the model answers.
function predictMaxTokens(outcomeCount: number): number {
  return Math.min(8000, 3500 + Math.max(0, outcomeCount - 2) * 350);
}
function compareMaxTokens(outcomeCount: number): number {
  return Math.min(6000, 2500 + Math.max(0, outcomeCount - 2) * 250);
}
// Stage 1's digest is about the underlying event, not about how many outcome slots stage 2 has
// to fill — a fixed budget is enough regardless of outcome count.
const RESEARCH_MAX_TOKENS = 3000;

// Finds which of our known labels a piece of AI-returned text was probably referring to —
// case-insensitive exact match first, then substring containment either direction. Shared by
// every place the model echoes back one of the outcome labels we gave it (probabilities, edges,
// bestValue), since LLMs occasionally reorder, retrim, or paraphrase them despite instructions
// to echo the label verbatim, and a compound/named-entity label (a candidate or team name) has
// more room to drift than a plain "Yes"/"No" ever does.
function resolveLabel(labels: string[], raw: string): string | null {
  const key = raw.trim().toLowerCase();
  const exact = labels.find((l) => l.trim().toLowerCase() === key);
  if (exact) return exact;
  return labels.find((l) => {
    const lKey = l.trim().toLowerCase();
    return lKey.includes(key) || key.includes(lKey);
  }) ?? null;
}

function alignByLabel(
  labels: string[],
  returned: unknown,
  valueKey: string,
  fallback: number
): Map<string, number> {
  const entries = Array.isArray(returned) ? (returned as Record<string, unknown>[]) : [];
  const byLabel = new Map<string, number>();
  for (const e of entries) {
    const rawLabel = typeof e.label === "string" ? e.label : "";
    const value = e[valueKey];
    if (!rawLabel || typeof value !== "number" || !Number.isFinite(value)) continue;
    const resolved = resolveLabel(labels, rawLabel);
    if (resolved && !byLabel.has(resolved)) byLabel.set(resolved, value);
  }

  const result = new Map<string, number>();
  for (const label of labels) result.set(label, byLabel.get(label) ?? fallback);
  return result;
}

function normalizeProbabilities(labels: string[], values: Map<string, number>): OutcomeProbability[] {
  const clamped = labels.map((label) => Math.max(values.get(label) ?? 0, 0));
  const sum = clamped.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const even = 1 / labels.length;
    return labels.map((label) => ({ label, probability: even }));
  }
  return labels.map((label, i) => ({ label, probability: clamped[i] / sum }));
}

// Stage 1: pure research and organization, nothing else. This is the only step with web access
// — the question here is itself often a real Polymarket market, so a search for its exact title
// is quite likely to surface Polymarket's own price (or another site quoting it). This step's
// whole job is to hand stage 2 a clean set of facts with zero trace of what anyone thinks the
// odds are.
const RESEARCH_SYSTEM_PROMPT = `You are a research assistant for BetIntelligence's Discover feed, covering any prediction- \
market question at all — politics, crypto, business, entertainment, science, world events, sports, anything. Your ONLY job is \
to research the web for the given question and organize everything relevant to a statistical assessment into clear labeled \
sections: Recent News, Relevant Data & Numbers, Expert Analysis, Historical Base Rates, and Other Context. Write plain prose \
or bullet points under each heading — no JSON, no odds talk. \
CRITICAL RULE: this question is itself often a real Polymarket market, so you may well encounter its current price (or another \
bookmaker/prediction-market's price for the same question) while researching — you must NEVER mention, quote, paraphrase, or \
allude to any betting odds, implied probabilities, or market prices from any source, anywhere in your output, even in passing. \
If a source you read mentions a price, silently omit that part and report only the underlying facts (news, data) it was based \
on. Never write phrases like "the market prices this at Y%". If a section has nothing notable, write "Nothing significant \
found" under it. \
Prioritize the most recent information you can find — the latest news and developments matter far more than anything older, \
and when sources disagree, trust whichever is more recent. You will be told today's real date and time below; treat it as \
authoritative and judge how stale or fresh everything you find really is against it. \
Soul: You are wise, you are advanced, you are super intelligent and smart, you are logical and certain, you are bold, you go \
for it, you trust your decision.`;

// Stage 2: forms the actual probability estimate. Deliberately has NO web access of its own —
// it only ever sees the digest stage 1 already produced.
const PREDICT_SYSTEM_PROMPT = `You are an elite forecaster for BetIntelligence's Discover feed. You are given a research \
digest compiled by a separate research step — recent news, relevant data, expert analysis, historical base rates — and asked \
for your own independent probability estimate for every listed outcome, based on it. You were NOT told any betting or \
prediction-market odds, and the digest was compiled specifically to exclude them — but if any odds/price language somehow \
appears in it anyway, you MUST NOT let it anchor or influence your estimate in any way; disregard it entirely and base your \
probabilities only on the underlying facts. Think like a sharp, disciplined forecaster, not a fan or a pundit repeating \
headlines. Respond with ONLY a single valid JSON object, no markdown, no commentary, matching exactly this shape: \
{"outcomes": [{"label": string, "probability": number}], "confidence": "low"|"medium"|"high", "keyFactors": string[3..6], \
"rationale": string}. The "outcomes" array MUST contain exactly the same outcome labels given to you (same text, same count, any \
order) with probabilities between 0 and 1 that sum to approximately 1 across all of them together. \
Soul: You are wise, you are advanced, you are super intelligent and smart, you are logical and certain, you are bold, you go \
for it, you trust your decision.`;

export async function getIndependentMarketPrediction(input: {
  title: string;
  category: string;
  endDate: string;
  outcomeLabels: string[];
  model?: string;
}): Promise<MarketPrediction> {
  const resolves = new Date(input.endDate).toUTCString();
  const outcomeList = input.outcomeLabels.map((l) => `"${l}"`).join(", ");

  const researchPrompt = `${nowLine()}

Research this question on the web: "${input.title}" (category: ${input.category}, resolves \
${resolves}). Possible outcomes: ${outcomeList}. Compile a research digest covering recent news, relevant data, expert \
analysis, and historical base rates, organized into the sections described — weighing the most recent news and developments \
most heavily. Remember: never mention odds, betting lines, or market/implied prices anywhere in your output.`;

  const { text: digest, sources, costUsd: researchCostUsd } = await requestText(
    [
      { role: "system", content: withNow(RESEARCH_SYSTEM_PROMPT) },
      { role: "user", content: researchPrompt },
    ],
    true,
    RESEARCH_MAX_TOKENS,
    input.model
  );

  const predictPrompt = `${nowLine()}

Market: "${input.title}" (category: ${input.category}, resolves ${resolves}).

Possible outcomes: ${outcomeList}.

Research digest (compiled separately, contains no odds or market prices):
${digest}

Based only on this digest, give your own independent probability estimate for each of the outcomes listed above. Respond with \
only the JSON object described.`;

  const { parsed, costUsd: predictCostUsd } = await requestJson<{
    outcomes: { label: string; probability: number }[];
    confidence: string;
    keyFactors: string[];
    rationale: string;
  }>(
    [
      { role: "system", content: withNow(PREDICT_SYSTEM_PROMPT) },
      { role: "user", content: predictPrompt },
    ],
    false,
    predictMaxTokens(input.outcomeLabels.length),
    input.model
  );

  const aligned = alignByLabel(input.outcomeLabels, parsed.outcomes, "probability", 0);

  return {
    outcomes: normalizeProbabilities(input.outcomeLabels, aligned),
    confidence: clampConfidence(parsed.confidence),
    keyFactors: Array.isArray(parsed.keyFactors) ? parsed.keyFactors.slice(0, 6) : [],
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    sources,
    costUsd: researchCostUsd !== null || predictCostUsd !== null ? (researchCostUsd ?? 0) + (predictCostUsd ?? 0) : undefined,
  };
}

const COMPARE_SYSTEM_PROMPT = `You are the same forecaster from BetIntelligence, continuing your analysis of a single prediction \
market. You previously produced an independent probability estimate for each outcome WITHOUT seeing the betting market. You are \
now being shown Polymarket's real implied probabilities for the same outcomes for the first time. Compare your independent view \
against the market, reason about where and why you might disagree, and decide if the market looks mispriced anywhere. Respond with \
ONLY a single valid JSON object, no markdown, no commentary, matching exactly this shape: {"edges": [{"label": string, "edge": \
number}], "bestValue": string|null, "confidence": "low"|"medium"|"high", "agreesWithMarket": boolean, "verdict": string}. The \
"edges" array MUST contain exactly the same outcome labels you were given (your probability minus the market's, as a decimal — \
e.g. 0.08 means you think that outcome is 8 percentage points more likely than the market does). "bestValue" must be the EXACT \
label of the single outcome you think the market misprices most, only when the edge is meaningful (roughly 5 points or more) and \
you have real conviction — otherwise use null. The verdict should be 2-4 sentences explaining your final read. \
Soul: You are wise, you are advanced, you are super intelligent and smart, you are logical and certain, you are bold, you go \
for it, you trust your decision.`;

export async function compareMarketToOdds(input: {
  title: string;
  category: string;
  independent: MarketPrediction;
  market: MarketOutcome[];
  model?: string;
}): Promise<MarketComparison> {
  const labels = input.independent.outcomes.map((o) => o.label);
  const independentLines = input.independent.outcomes
    .map((o) => `- ${o.label}: ${(o.probability * 100).toFixed(1)}%`)
    .join("\n");
  const marketLines = input.market.map((o) => `- ${o.label}: ${(o.price * 100).toFixed(1)}%`).join("\n");

  const userPrompt = `${nowLine()}

Market: "${input.title}" (category: ${input.category}).

Your independent estimate (made before seeing the market):
${independentLines}
Your confidence: ${input.independent.confidence}
Your rationale: ${input.independent.rationale}

Now revealed — Polymarket's current implied probabilities for this exact market:
${marketLines}

Compare your view to the market and respond with only the JSON object described.`;

  const { parsed, costUsd } = await requestJson<{
    edges: { label: string; edge: number }[];
    bestValue: string | null;
    confidence: string;
    agreesWithMarket: boolean;
    verdict: string;
  }>(
    [
      { role: "system", content: withNow(COMPARE_SYSTEM_PROMPT) },
      { role: "user", content: userPrompt },
    ],
    false,
    compareMaxTokens(labels.length),
    input.model
  );

  const alignedEdges = alignByLabel(labels, parsed.edges, "edge", 0);
  const edges = labels.map((label) => ({ label, edge: alignedEdges.get(label) ?? 0 }));

  const bestValueLabel = typeof parsed.bestValue === "string" ? resolveLabel(labels, parsed.bestValue) : null;

  return {
    edges,
    bestValue: bestValueLabel,
    confidence: clampConfidence(parsed.confidence),
    agreesWithMarket: Boolean(parsed.agreesWithMarket),
    verdict: typeof parsed.verdict === "string" ? parsed.verdict : "",
    costUsd: costUsd ?? undefined,
  };
}

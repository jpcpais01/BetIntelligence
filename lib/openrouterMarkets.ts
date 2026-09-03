import { requestJson, clampConfidence } from "./openrouter";
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

const PREDICT_SYSTEM_PROMPT = `You are an elite forecaster for BetIntelligence's Discover feed, covering any prediction-market \
question at all — politics, crypto, business, entertainment, science, world events, sports, anything. You independently research \
the web and form your own probability estimate for every listed outcome. You are NOT told any betting or prediction-market odds \
and must not guess or assume specific market prices. Think like a sharp, disciplined forecaster, not a fan or a pundit repeating \
headlines. Respond with ONLY a single valid JSON object, no markdown, no commentary, matching exactly this shape: \
{"outcomes": [{"label": string, "probability": number}], "confidence": "low"|"medium"|"high", "keyFactors": string[3..6], \
"rationale": string}. The "outcomes" array MUST contain exactly the same outcome labels given to you (same text, same count, any \
order) with probabilities between 0 and 1 that sum to approximately 1 across all of them together.`;

export async function getIndependentMarketPrediction(input: {
  title: string;
  category: string;
  endDate: string;
  outcomeLabels: string[];
}): Promise<MarketPrediction> {
  const resolves = new Date(input.endDate).toUTCString();
  const outcomeList = input.outcomeLabels.map((l) => `"${l}"`).join(", ");
  const userPrompt = `Market: "${input.title}" (category: ${input.category}, resolves ${resolves}).

Possible outcomes: ${outcomeList}.

Research this question on the web — recent news, relevant data, expert analysis, historical base rates, anything that bears on \
it — then give your own independent probability estimate for each of the outcomes listed above. Respond with only the JSON object \
described.`;

  const { parsed, sources } = await requestJson<{
    outcomes: { label: string; probability: number }[];
    confidence: string;
    keyFactors: string[];
    rationale: string;
  }>(
    [
      { role: "system", content: PREDICT_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    true,
    predictMaxTokens(input.outcomeLabels.length)
  );

  const aligned = alignByLabel(input.outcomeLabels, parsed.outcomes, "probability", 0);

  return {
    outcomes: normalizeProbabilities(input.outcomeLabels, aligned),
    confidence: clampConfidence(parsed.confidence),
    keyFactors: Array.isArray(parsed.keyFactors) ? parsed.keyFactors.slice(0, 6) : [],
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    sources,
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
you have real conviction — otherwise use null. The verdict should be 2-4 sentences explaining your final read.`;

export async function compareMarketToOdds(input: {
  title: string;
  category: string;
  independent: MarketPrediction;
  market: MarketOutcome[];
}): Promise<MarketComparison> {
  const labels = input.independent.outcomes.map((o) => o.label);
  const independentLines = input.independent.outcomes
    .map((o) => `- ${o.label}: ${(o.probability * 100).toFixed(1)}%`)
    .join("\n");
  const marketLines = input.market.map((o) => `- ${o.label}: ${(o.price * 100).toFixed(1)}%`).join("\n");

  const userPrompt = `Market: "${input.title}" (category: ${input.category}).

Your independent estimate (made before seeing the market):
${independentLines}
Your confidence: ${input.independent.confidence}
Your rationale: ${input.independent.rationale}

Now revealed — Polymarket's current implied probabilities for this exact market:
${marketLines}

Compare your view to the market and respond with only the JSON object described.`;

  const { parsed } = await requestJson<{
    edges: { label: string; edge: number }[];
    bestValue: string | null;
    confidence: string;
    agreesWithMarket: boolean;
    verdict: string;
  }>(
    [
      { role: "system", content: COMPARE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    false,
    compareMaxTokens(labels.length)
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
  };
}

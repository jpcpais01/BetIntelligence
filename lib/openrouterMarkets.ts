import { requestJson, clampConfidence } from "./openrouter";
import type { MarketComparison, MarketOutcome, MarketPrediction, OutcomeProbability } from "./types";

// Matches the AI's returned outcomes back onto the exact labels we asked about — the model is
// asked to echo the same label set, but LLMs occasionally reorder, retrim, or paraphrase them.
// Case-insensitive exact match first, then substring containment, then (rarely) a shared
// fallback value so no known outcome is ever silently dropped from the UI.
function alignByLabel(
  labels: string[],
  returned: unknown,
  valueKey: string,
  fallback: number
): Map<string, number> {
  const entries = Array.isArray(returned) ? (returned as Record<string, unknown>[]) : [];
  const byNormalized = new Map<string, number>();
  for (const e of entries) {
    const label = typeof e.label === "string" ? e.label : "";
    const value = e[valueKey];
    if (label && typeof value === "number" && Number.isFinite(value)) {
      byNormalized.set(label.trim().toLowerCase(), value);
    }
  }

  const result = new Map<string, number>();
  for (const label of labels) {
    const key = label.trim().toLowerCase();
    if (byNormalized.has(key)) {
      result.set(label, byNormalized.get(key)!);
      continue;
    }
    const partial = [...byNormalized.entries()].find(([k]) => k.includes(key) || key.includes(k));
    result.set(label, partial ? partial[1] : fallback);
  }
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
    3000
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
    2000
  );

  const alignedEdges = alignByLabel(labels, parsed.edges, "edge", 0);
  const edges = labels.map((label) => ({ label, edge: alignedEdges.get(label) ?? 0 }));

  const bestValueLabel =
    typeof parsed.bestValue === "string"
      ? labels.find((l) => l.toLowerCase() === parsed.bestValue!.trim().toLowerCase()) ?? null
      : null;

  return {
    edges,
    bestValue: bestValueLabel,
    confidence: clampConfidence(parsed.confidence),
    agreesWithMarket: Boolean(parsed.agreesWithMarket),
    verdict: typeof parsed.verdict === "string" ? parsed.verdict : "",
  };
}

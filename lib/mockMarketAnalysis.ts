import type { MarketComparison, MarketOutcome, MarketPrediction } from "./types";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getMockMarketPrediction(input: {
  title: string;
  outcomeLabels: string[];
}): Promise<MarketPrediction> {
  await delay(900);
  const n = input.outcomeLabels.length;
  // A mild bias toward the first outcome so the mock has something to say, evenly split otherwise.
  const outcomes = input.outcomeLabels.map((label, i) => ({
    label,
    probability: i === 0 ? 0.4 : 0.6 / (n - 1 || 1),
  }));

  return {
    outcomes,
    confidence: "medium",
    keyFactors: [
      `Recent coverage leans toward "${input.outcomeLabels[0]}"`,
      "Historical base rates for similar questions favor this direction",
      "No major contradicting signals found in current reporting",
    ],
    rationale: `Based on available information, "${input.outcomeLabels[0]}" looks somewhat more likely than the market may reflect, though this is mock data — connect a real OPENROUTER_API_KEY to get live analysis.`,
    sources: [
      { url: "https://example.com/coverage", title: "Recent coverage and analysis" },
      { url: "https://example.com/background", title: "Background and historical context" },
    ],
    costUsd: 0.0031,
  };
}

export async function getMockMarketComparison(input: {
  independent: MarketPrediction;
  market: MarketOutcome[];
}): Promise<MarketComparison> {
  await delay(700);
  const marketByLabel = new Map(input.market.map((o) => [o.label, o.price]));
  const edges = input.independent.outcomes.map((o) => ({
    label: o.label,
    edge: o.probability - (marketByLabel.get(o.label) ?? 0),
  }));
  const best = edges.reduce((a, b) => (Math.abs(b.edge) > Math.abs(a.edge) ? b : a));
  const hasEdge = Math.abs(best.edge) >= 0.05;

  return {
    edges,
    bestValue: hasEdge ? best.label : null,
    confidence: "medium",
    agreesWithMarket: !hasEdge,
    verdict: hasEdge
      ? `The market is pricing "${best.label}" noticeably differently from my independent read. This looks like a mock value spot — connect a real OPENROUTER_API_KEY to get live analysis.`
      : "My independent estimate lines up closely with the market's pricing here. This is mock data — connect a real OPENROUTER_API_KEY to get live analysis.",
    costUsd: 0.0017,
  };
}

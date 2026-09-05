import type { ComparisonResult, IndependentPrediction, Probabilities } from "./types";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Under MOCK_AI, the eventual prediction never actually reads this digest — but the client always
// fetches one first (see app/api/analyze/football-digest and AnalysisSheet.tsx), so this exists to
// keep that call working without a real FOOTBALL_DATA_API_KEY configured.
export async function getMockFootballDigest(input: { homeTeam: string; awayTeam: string }): Promise<string> {
  await delay(400);
  return `Match Status:
Match has not started yet — mock digest, no real football-data.org call was made.

${input.homeTeam} Form (last 5 completed matches):
- Mock data: connect a real FOOTBALL_DATA_API_KEY for live form.

${input.awayTeam} Form (last 5 completed matches):
- Mock data: connect a real FOOTBALL_DATA_API_KEY for live form.

Head-to-Head History (last 5 meetings):
- Mock data: connect a real FOOTBALL_DATA_API_KEY for live head-to-head history.`;
}

export async function getMockIndependentPrediction(input: {
  homeTeam: string;
  awayTeam: string;
}): Promise<IndependentPrediction> {
  await delay(900);
  return {
    home: 0.48,
    draw: 0.24,
    away: 0.28,
    confidence: "medium",
    homeAssessment: {
      pros: [`Unbeaten in 5 of last 6 home matches`, "Stronger recent underlying xG numbers"],
      cons: ["Historical head-to-head is fairly even over the last 10 meetings"],
    },
    awayAssessment: {
      pros: ["Historical head-to-head is fairly even over the last 10 meetings"],
      cons: ["Missing two starting defenders through injury"],
    },
    summary: `${input.homeTeam} look slightly favoured at home given their current form and ${input.awayTeam}'s defensive injuries, though the gap isn't huge — this looks like a competitive match with a real draw possibility.`,
    sources: [
      { url: "https://example.com/team-news", title: "Team news: injury update ahead of the weekend" },
      { url: "https://example.com/form-guide", title: "Form guide — last six matches" },
      { url: "https://example.com/head-to-head", title: "Head-to-head record and recent meetings" },
    ],
    costUsd: 0.0023,
  };
}

export async function getMockComparison(input: {
  independent: IndependentPrediction;
  market: Probabilities;
}): Promise<ComparisonResult> {
  await delay(700);
  const edges: Probabilities = {
    home: input.independent.home - input.market.home,
    draw: input.independent.draw - input.market.draw,
    away: input.independent.away - input.market.away,
  };
  const entries = Object.entries(edges) as [keyof Probabilities, number][];
  const [bestKey, bestEdge] = entries.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));

  return {
    edges,
    bestValue: Math.abs(bestEdge) >= 0.05 ? bestKey : "none",
    confidence: "medium",
    agreesWithMarket: Math.abs(bestEdge) < 0.05,
    verdict:
      Math.abs(bestEdge) >= 0.05
        ? `The market is pricing this ${bestKey === "draw" ? "draw" : bestKey + " win"} noticeably lower than my independent read, mainly due to the injury news the market may be underweighting. This looks like a mock value spot — connect a real OPENROUTER_API_KEY to get live analysis.`
        : "My independent estimate lines up closely with Polymarket's pricing here — the market looks efficient on this one. This is mock data — connect a real OPENROUTER_API_KEY to get live analysis.",
    costUsd: 0.0012,
  };
}

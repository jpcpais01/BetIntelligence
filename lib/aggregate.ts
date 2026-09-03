// Turns N independent research runs (same match/market, asked fresh each time, no market odds
// shown) into one merged read plus a measure of how much the runs actually agreed with each
// other. A single run can't tell you whether an estimate is a stable read or a coin flip that
// happened to land somewhere — running it more than once and looking at the spread can.
import type {
  IndependentPrediction,
  MarketPrediction,
  OutcomeProbability,
  Probabilities,
  Confidence,
  SourceCitation,
  ResearchSummary,
} from "./types";

export interface RunAgreement {
  runCount: number;
  agreementPct: number; // 0-1: fraction of runs whose own top pick matches the merged top pick
  spread: number; // 0-1ish: mean stdev across outcomes — higher means the runs disagreed more
}

export function agreementTone(agreement: RunAgreement): "high" | "medium" | "low" {
  if (agreement.runCount <= 1) return "high";
  if (agreement.agreementPct >= 0.8 && agreement.spread < 0.06) return "high";
  if (agreement.agreementPct >= 0.5 && agreement.spread < 0.14) return "medium";
  return "low";
}

export function agreementLabel(agreement: RunAgreement): string {
  const tone = agreementTone(agreement);
  const pct = Math.round(agreement.agreementPct * 100);
  if (tone === "high") return `Strong agreement — ${pct}% of runs picked the same outcome`;
  if (tone === "medium") return `Some disagreement — ${pct}% of runs picked the same outcome`;
  return `Runs were split — only ${pct}% agreed on the top outcome`;
}

function mostCommonConfidence(runs: { confidence: Confidence }[]): Confidence {
  const counts: Record<Confidence, number> = { low: 0, medium: 0, high: 0 };
  for (const r of runs) counts[r.confidence]++;
  if (counts.high >= counts.medium && counts.high >= counts.low && counts.high > 0) return "high";
  if (counts.low > counts.medium && counts.low > counts.high) return "low";
  return "medium";
}

function mergeKeyFactors(runs: { keyFactors: string[] }[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const run of runs) {
    for (const factor of run.keyFactors) {
      const key = factor.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(factor);
      if (merged.length >= 6) return merged;
    }
  }
  return merged;
}

function mergeSources(runs: { sources?: SourceCitation[] }[]): SourceCitation[] {
  const seen = new Set<string>();
  const merged: SourceCitation[] = [];
  for (const run of runs) {
    for (const s of run.sources ?? []) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      merged.push(s);
      if (merged.length >= 10) return merged;
    }
  }
  return merged;
}

// ---------- Football (fixed home/draw/away shape) ----------

function footballTopOutcome(p: Probabilities): "home" | "draw" | "away" {
  if (p.home >= p.draw && p.home >= p.away) return "home";
  if (p.away >= p.draw) return "away";
  return "draw";
}

export function aggregateFootballRuns(runs: IndependentPrediction[]): {
  average: Probabilities;
  agreement: RunAgreement;
} {
  const n = runs.length;
  const sum = runs.reduce(
    (acc, r) => ({ home: acc.home + r.home, draw: acc.draw + r.draw, away: acc.away + r.away }),
    { home: 0, draw: 0, away: 0 }
  );
  const average: Probabilities = { home: sum.home / n, draw: sum.draw / n, away: sum.away / n };

  const top = footballTopOutcome(average);
  const agreementPct = runs.filter((r) => footballTopOutcome(r) === top).length / n;
  const spread =
    (["home", "draw", "away"] as const).reduce((acc, key) => {
      const mean = average[key];
      const variance = runs.reduce((s, r) => s + (r[key] - mean) ** 2, 0) / n;
      return acc + Math.sqrt(variance);
    }, 0) / 3;

  return { average, agreement: { runCount: n, agreementPct, spread } };
}

// Builds the single IndependentPrediction fed into the compare step and saved as the pick's
// "independent" read, when more than one run was made.
export function synthesizeFootballIndependent(runs: IndependentPrediction[]): IndependentPrediction {
  if (runs.length === 1) return runs[0];

  const { average, agreement } = aggregateFootballRuns(runs);
  const top = footballTopOutcome(average);
  const representative = runs.find((r) => footballTopOutcome(r) === top) ?? runs[0];

  return {
    home: average.home,
    draw: average.draw,
    away: average.away,
    confidence: mostCommonConfidence(runs),
    keyFactors: mergeKeyFactors(runs),
    rationale:
      `Averaged across ${runs.length} independent research runs (${Math.round(agreement.agreementPct * 100)}% agreed ` +
      `on the same top outcome). Representative take: ${representative.rationale}`,
    sources: mergeSources(runs),
  };
}

// ---------- Discover markets (arbitrary labeled outcomes) ----------

function marketTopLabel(outcomes: OutcomeProbability[]): string {
  return outcomes.reduce((best, o) => (o.probability > best.probability ? o : best), outcomes[0]).label;
}

export function aggregateMarketRuns(runs: MarketPrediction[]): {
  average: OutcomeProbability[];
  agreement: RunAgreement;
} {
  const labels = runs[0].outcomes.map((o) => o.label);
  const n = runs.length;

  const sums = new Map<string, number>(labels.map((l) => [l, 0]));
  for (const run of runs) {
    for (const o of run.outcomes) sums.set(o.label, (sums.get(o.label) ?? 0) + o.probability);
  }
  const average = labels.map((label) => ({ label, probability: (sums.get(label) ?? 0) / n }));

  const topLabel = marketTopLabel(average);
  const agreementPct = runs.filter((r) => marketTopLabel(r.outcomes) === topLabel).length / n;
  const spread =
    labels.reduce((acc, label) => {
      const mean = average.find((o) => o.label === label)?.probability ?? 0;
      const variance =
        runs.reduce((s, run) => {
          const p = run.outcomes.find((o) => o.label === label)?.probability ?? 0;
          return s + (p - mean) ** 2;
        }, 0) / n;
      return acc + Math.sqrt(variance);
    }, 0) / labels.length;

  return { average, agreement: { runCount: n, agreementPct, spread } };
}

export function synthesizeMarketIndependent(runs: MarketPrediction[]): MarketPrediction {
  if (runs.length === 1) return runs[0];

  const { average, agreement } = aggregateMarketRuns(runs);
  const topLabel = marketTopLabel(average);
  const representative = runs.find((r) => marketTopLabel(r.outcomes) === topLabel) ?? runs[0];

  return {
    outcomes: average,
    confidence: mostCommonConfidence(runs),
    keyFactors: mergeKeyFactors(runs),
    rationale:
      `Averaged across ${runs.length} independent research runs (${Math.round(agreement.agreementPct * 100)}% agreed ` +
      `on the same top outcome). Representative take: ${representative.rationale}`,
    sources: mergeSources(runs),
  };
}

// The compact, storable form of a set of runs — used both when saving a pick and when caching
// "last analysis" for a card, so the two call sites (and football/markets) build this the same
// way instead of duplicating the shape logic.
export function toFootballResearchSummary(runs: IndependentPrediction[]): ResearchSummary<Probabilities> | undefined {
  if (runs.length <= 1) return undefined;
  const { agreement } = aggregateFootballRuns(runs);
  return {
    runCount: agreement.runCount,
    agreementPct: agreement.agreementPct,
    spread: agreement.spread,
    runs: runs.map((r) => ({ home: r.home, draw: r.draw, away: r.away })),
  };
}

export function toMarketResearchSummary(
  runs: MarketPrediction[]
): ResearchSummary<OutcomeProbability[]> | undefined {
  if (runs.length <= 1) return undefined;
  const { agreement } = aggregateMarketRuns(runs);
  return {
    runCount: agreement.runCount,
    agreementPct: agreement.agreementPct,
    spread: agreement.spread,
    runs: runs.map((r) => r.outcomes),
  };
}

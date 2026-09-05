// A plain-language read on how "risky" a pick is, purely from the market's own probability of
// the outcome in question — a heavy favorite reads as safe, a longshot reads as risky. This is
// deliberately independent of the AI's view (edge, confidence): it answers "if this hits, how
// surprised should anyone be", not "is this a good bet".
export type RiskLevel = "calm" | "easy" | "normal" | "risky" | "mega";

interface RiskTier {
  id: RiskLevel;
  label: string;
  // The lowest market probability (inclusive) this tier covers — tiers are checked highest
  // probability first, so the first one a probability clears is its tier.
  minProbability: number;
}

// Five tiers, safest to longest-shot. Boundaries are a judgment call (no external benchmark for
// "what counts as risky" exists), chosen so a plain coin-flip lands squarely in "normal" and each
// tier reads as a genuinely different bet, not a hair-split of the one next to it.
const TIERS: RiskTier[] = [
  { id: "calm", label: "Calm", minProbability: 0.7 },
  { id: "easy", label: "Easy", minProbability: 0.55 },
  { id: "normal", label: "Normal", minProbability: 0.4 },
  { id: "risky", label: "Risky", minProbability: 0.25 },
  { id: "mega", label: "Mega", minProbability: 0 },
];

export function riskLevelFor(probability: number): RiskLevel {
  for (const tier of TIERS) {
    if (probability >= tier.minProbability) return tier.id;
  }
  return "mega";
}

export function riskLevelLabel(level: RiskLevel): string {
  return TIERS.find((t) => t.id === level)?.label ?? level;
}

export function allRiskLevels(): RiskLevel[] {
  return TIERS.map((t) => t.id);
}

// One shared color per tier (CSS custom properties, app/globals.css) — calm reads as safe/green,
// mega as hot/red, so the same five colors work for a one-word badge on a card and for a whole
// category's worth of bars on Home without needing two separate palettes to stay in sync.
const COLOR_VAR: Record<RiskLevel, string> = {
  calm: "var(--risk-calm)",
  easy: "var(--risk-easy)",
  normal: "var(--risk-normal)",
  risky: "var(--risk-risky)",
  mega: "var(--risk-mega)",
};

export function riskLevelColor(level: RiskLevel): string {
  return COLOR_VAR[level];
}

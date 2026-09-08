// A plain-language read on how bold a call the AI actually made — from its own AI-vs-market edge
// on the specific outcome it recommended, not the market's raw probability. A tiny 6-point edge on
// a market favorite and a tiny 6-point edge on a rank outsider are the same size of claim ("I think
// this is 6pp more likely than the market does"), so they get the same tier; what used to live here
// instead classified by how big a favorite the market itself thought the pick was — a number that
// says nothing about how much the AI actually disagreed with the market, which is the whole point
// of a "risk" read on an AI recommendation. A pick the AI barely flagged (an edge that only just
// cleared its own "worth mentioning" bar) reads as Mega here even if it happens to be a market
// favorite; a huge-conviction call reads as Calm even on a rank outsider.
export type RiskLevel = "calm" | "easy" | "normal" | "risky" | "mega";

interface RiskTier {
  id: RiskLevel;
  label: string;
  // The lowest AI-vs-market edge (inclusive, as a decimal — 0.10 = 10 percentage points) this tier
  // covers. Tiers are checked highest first, so the first one an edge clears is its tier; "mega" has
  // no floor of its own; it's simply whatever's left under "risky"'s.
  minEdge: number;
}

// Five tiers, boldest call to most marginal one. Boundaries are a judgment call (no external
// benchmark exists for "how big an edge counts as a bold call"), loosely anchored to Lab's own risk
// presets (lib/riskModes.ts — Calm/Risky/Mega share these same 10/3/1-point floors) with one new
// value (Easy, 7pp) inserted to break a tie that only ever made sense for Lab's own favorite-only
// vs. any-outcome axis, which doesn't apply to classifying a single already-made recommendation.
// COMPARE_SYSTEM_PROMPT (lib/openrouter.ts) tells the model to flag a bestValue at all only once its
// own edge clears roughly 5pp — so in practice most real recommendations land in Calm/Easy/Normal,
// and Risky/Mega mark the genuine edge cases where the model went with a thinner margin anyway.
const TIERS: RiskTier[] = [
  { id: "calm", label: "Calm", minEdge: 0.1 },
  { id: "easy", label: "Easy", minEdge: 0.07 },
  { id: "normal", label: "Normal", minEdge: 0.05 },
  { id: "risky", label: "Risky", minEdge: 0.03 },
  { id: "mega", label: "Mega", minEdge: 0 },
];

// `edge` is (AI probability - market probability) as a decimal for whichever single outcome is
// being rated — never a raw probability. A negative edge (the AI's own recommendation still traded
// unfavorably against a live-repriced market, or a leg backed against the AI's own read) reads as
// Mega, the same catch-all bottom tier as a barely-positive one — both are "no real edge behind
// this call" in the sense this scale cares about.
export function riskLevelFor(edge: number): RiskLevel {
  for (const tier of TIERS) {
    if (edge >= tier.minEdge) return tier.id;
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

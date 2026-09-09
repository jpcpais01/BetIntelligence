import type { SavedPick } from "./types";
import { legFromPick, isMarketFavorite, type Outcome, type SlipLeg } from "./betslip";
import { liveKey } from "./livePrices";

// Re-exported so every risk-classification concept has one home: a consumer classifying a single
// recommendation (GameCard, Edge Score) only ever needs to import from this file, even though the
// helper itself lives in lib/betslip.ts (this file already depends on betslip.ts for SlipLeg/
// Outcome, so defining it there instead of here avoids a circular import between the two).
export { isMarketFavorite };

// The single classification for how bold an AI recommendation is — used both by Lab's one-tap
// slip builder (below: scan every saved pick for its best qualifying leg per mode) AND by every
// other consumer that needs to rate a single already-made recommendation (GameCard's badge/
// border, the Edge Score breakdown). There used to be two separate systems here — this file's
// edge-range-plus-favorite-only scale, and a second, simpler edge-only scale (lib/riskLevel.ts,
// now deleted) invented specifically because classifying a single recommendation didn't have a
// "favorite" concept readily at hand. It does: `isMarketFavorite` below answers that from the
// same market probabilities every consumer already has, so there's no reason for two scales to
// exist — riskModeFor is the one true reverse of this file's own search logic.
//
// "safer" tiers only ever count a recommendation that backs the match's own favorite (home/draw/
// away, never a double-chance combo — a combo is definitionally more likely than either outcome
// it covers, so it would always look like "the favorite" without actually being what the market
// is picking), while looser tiers count any of the five leg types (home/draw/away/1X/X2) and need
// less of an edge to qualify.
export type RiskMode = "calm" | "easy" | "normal" | "risky" | "mega";

export interface RiskModeInfo {
  id: RiskMode;
  label: string;
  minEdge: number; // decimal, e.g. 0.10 = 10 percentage points of AI-vs-market edge
  // Exclusive upper bound — a leg qualifies for this mode only when minEdge <= edge < maxEdge.
  // Without a ceiling, a huge-edge favorite would happily satisfy every looser mode's minEdge too,
  // so tapping "Mega" (which only asks for 1+pp) could surface the exact same rock-solid favorite
  // "Calm" would have picked, rather than the marginal, genuinely riskier signal Mega is for. Each
  // mode's ceiling is the minEdge of the tier immediately above it, so the five ranges partition
  // the edge axis with no gaps or overlaps: [10, Infinity), [5, 10), [5, 10), [3, 5), [1, 3).
  // "Easy" and "Normal" deliberately share both ends of that range — they're not ranked against
  // each other by edge at all, only by favoriteOnly, so giving them different edge windows would
  // invent a distinction that isn't real. Infinity marks the one mode (Calm) with no tier above it.
  maxEdge: number;
  favoriteOnly: boolean;
}

export const RISK_MODES: RiskModeInfo[] = [
  { id: "calm", label: "Calm", minEdge: 0.1, maxEdge: Infinity, favoriteOnly: true },
  { id: "easy", label: "Easy", minEdge: 0.05, maxEdge: 0.1, favoriteOnly: true },
  { id: "normal", label: "Normal", minEdge: 0.05, maxEdge: 0.1, favoriteOnly: false },
  { id: "risky", label: "Risky", minEdge: 0.03, maxEdge: 0.05, favoriteOnly: false },
  { id: "mega", label: "Mega", minEdge: 0.01, maxEdge: 0.03, favoriteOnly: false },
];

// The reverse of bestCandidateForPick's search below: given a single already-known (edge,
// isFavorite) pair, which one tier does it belong to? Walks tiers top-down (boldest first),
// skipping a favorite-only tier when isFavorite is false, and matching on minEdge alone — maxEdge
// only matters for the search below (partitioning a POOL of candidates so a huge-edge pick doesn't
// satisfy every looser mode's floor too); a single already-decided recommendation just needs the
// highest tier its own edge and favorite status actually clear, with "mega" as the catch-all
// bottom (including a small or negative edge) the same way it already was before this file had a
// favorite-aware classification. This means an edge that would fall inside a gap between a
// favorite-only tier's floor and a shared tier's ceiling (e.g. a 12pp edge on a genuine underdog —
// past Normal's search-only 10pp ceiling but nowhere near a favorite-only tier that would take it)
// still resolves to Normal here, the highest non-favorite-restricted tier that edge clears — the
// best a non-favorite claim can ever be rated, since Calm/Easy are reserved for favorites by
// design regardless of how large the edge on an underdog gets.
export function riskModeFor(edge: number, isFavorite: boolean): RiskMode {
  for (const mode of RISK_MODES) {
    if (mode.favoriteOnly && !isFavorite) continue;
    if (edge >= mode.minEdge) return mode.id;
  }
  return "mega";
}

export function riskModeLabel(mode: RiskMode): string {
  return RISK_MODES.find((m) => m.id === mode)?.label ?? mode;
}

export function allRiskModes(): RiskMode[] {
  return RISK_MODES.map((m) => m.id);
}

// Whether a tier requires the backed outcome to be the match's own favorite — Calm and Easy only.
// Exported so a consumer that ALSO needs to reflect this rule in its own UI (the Overview page,
// lib/overview.ts: a combo leg is never the favorite, so Calm/Easy can never have a "combo
// strategy" row at all) can ask directly rather than re-deriving it from RISK_MODES itself.
export function isFavoriteOnlyMode(mode: RiskMode): boolean {
  return RISK_MODES.find((m) => m.id === mode)?.favoriteOnly ?? false;
}

// One shared color per tier (CSS custom properties, app/globals.css) — calm reads as safe/green,
// mega as hot/red, so the same five colors work for a one-word badge on a card, for Home's Edge
// Score breakdown, and for a card's own border without needing separate palettes to stay in sync.
const COLOR_VAR: Record<RiskMode, string> = {
  calm: "var(--risk-calm)",
  easy: "var(--risk-easy)",
  normal: "var(--risk-normal)",
  risky: "var(--risk-risky)",
  mega: "var(--risk-mega)",
};

export function riskModeColor(mode: RiskMode): string {
  return COLOR_VAR[mode];
}

interface Candidate {
  pick: SavedPick;
  outcome: Outcome;
  edge: number;
}

function bestCandidateForPick(
  pick: SavedPick,
  mode: RiskModeInfo,
  livePrices: Record<string, number>
): Candidate | null {
  const liveHome = livePrices[liveKey(pick.id, pick.homeTeam)] ?? pick.market.home;
  const liveDraw = livePrices[liveKey(pick.id, "Draw")] ?? pick.market.draw;
  const liveAway = livePrices[liveKey(pick.id, pick.awayTeam)] ?? pick.market.away;

  const options: { outcome: Outcome; market: number; ai: number }[] = [
    { outcome: "home", market: liveHome, ai: pick.independent.home },
    { outcome: "draw", market: liveDraw, ai: pick.independent.draw },
    { outcome: "away", market: liveAway, ai: pick.independent.away },
    { outcome: "1x", market: liveHome + liveDraw, ai: pick.independent.home + pick.independent.draw },
    { outcome: "x2", market: liveDraw + liveAway, ai: pick.independent.draw + pick.independent.away },
  ];

  if (mode.favoriteOnly) {
    const favorite = options.slice(0, 3).reduce((a, b) => (b.market > a.market ? b : a));
    const edge = favorite.ai - favorite.market;
    return inRange(edge, mode) ? { pick, outcome: favorite.outcome, edge } : null;
  }

  let best: Candidate | null = null;
  for (const o of options) {
    const edge = o.ai - o.market;
    if (inRange(edge, mode) && (!best || edge > best.edge)) {
      best = { pick, outcome: o.outcome, edge };
    }
  }
  return best;
}

function inRange(edge: number, mode: RiskModeInfo): boolean {
  return edge >= mode.minEdge && edge < mode.maxEdge;
}

const SLIP_SIZE = 3;

// Builds an auto-generated slip for one risk mode: at most one leg per game (its single best
// qualifying outcome, so a correlated pair like a team's win and its own double-chance never both
// end up in the same parlay), capped at exactly 3 legs — the highest-edge qualifying games first,
// whatever kind of bet each one is. Returns null when fewer than 3 games qualify at all, which the
// caller shows as "not enough games for this mode."
export function buildRiskSlip(
  picks: SavedPick[],
  livePrices: Record<string, number>,
  modeId: RiskMode
): SlipLeg[] | null {
  const mode = RISK_MODES.find((m) => m.id === modeId);
  if (!mode) return null;

  const candidates = picks
    .map((pick) => bestCandidateForPick(pick, mode, livePrices))
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => b.edge - a.edge);

  if (candidates.length < SLIP_SIZE) return null;

  return candidates.slice(0, SLIP_SIZE).map((c) => legFromPick(c.pick, c.outcome));
}

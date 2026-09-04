import type { SavedPick } from "./types";
import { legFromPick, type Outcome, type SlipLeg } from "./betslip";
import { liveKey } from "./livePrices";

// Five risk presets for Lab's one-tap slip builder. Each scans every saved football pick for its
// single best qualifying leg and assembles them into a slip — "safer" presets only ever bet the
// match's own favorite (home/draw/away, never a double-chance combo — a combo is definitionally
// more likely than either outcome it covers, so it would always look like "the favorite" without
// actually being what the market is picking), while looser presets can pick any of the five leg
// types (home/draw/away/1X/X2) and need less of an edge to qualify.
export type RiskMode = "calm" | "easy" | "normal" | "risky" | "mega";

export interface RiskModeInfo {
  id: RiskMode;
  label: string;
  minEdge: number; // decimal, e.g. 0.10 = 10 percentage points of AI-vs-market edge
  favoriteOnly: boolean;
}

export const RISK_MODES: RiskModeInfo[] = [
  { id: "calm", label: "Calm", minEdge: 0.1, favoriteOnly: true },
  { id: "easy", label: "Easy", minEdge: 0.05, favoriteOnly: true },
  { id: "normal", label: "Normal", minEdge: 0.05, favoriteOnly: false },
  { id: "risky", label: "Risky", minEdge: 0.03, favoriteOnly: false },
  { id: "mega", label: "Mega", minEdge: 0.01, favoriteOnly: false },
];

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
    return edge >= mode.minEdge ? { pick, outcome: favorite.outcome, edge } : null;
  }

  let best: Candidate | null = null;
  for (const o of options) {
    const edge = o.ai - o.market;
    if (edge >= mode.minEdge && (!best || edge > best.edge)) {
      best = { pick, outcome: o.outcome, edge };
    }
  }
  return best;
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

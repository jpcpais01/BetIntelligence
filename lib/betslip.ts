import type { SavedPick, SavedMarketPick } from "./types";

// v2: legs now carry a resolved title/meta/outcomeLabel directly instead of a fixed
// home/draw/away enum plus raw match fields, so a leg can come from either a football pick or
// any Discover market pick. Old v1 slips (pre-unification) are simply orphaned rather than
// migrated — this is local paper-trading data, not anything worth a migration path for.
const STORAGE_KEY = "betintelligence.slip.v2";

export type Outcome = "home" | "draw" | "away";

export interface SlipLeg {
  pickId: string;
  kind: "sports" | "market";
  title: string; // "Arsenal v Chelsea" for sports, the market question for a market pick
  meta: string; // "🏴 Premier League" for sports, "💼 Business" for a market pick
  outcomeLabel: string; // "Arsenal" / "Draw" / "Chelsea", or the chosen market outcome's label
  marketProb: number;
  aiProb: number;
}

export function legFromPick(pick: SavedPick, outcome: Outcome): SlipLeg {
  return {
    pickId: pick.id,
    kind: "sports",
    title: `${pick.homeTeam} v ${pick.awayTeam}`,
    meta: `${pick.leagueFlag} ${pick.leagueName}`,
    outcomeLabel: outcome === "draw" ? "Draw" : outcome === "home" ? pick.homeTeam : pick.awayTeam,
    marketProb: pick.market[outcome],
    aiProb: pick.independent[outcome],
  };
}

export function legFromMarketPick(pick: SavedMarketPick, outcomeLabel: string): SlipLeg | null {
  const ai = pick.independent.outcomes.find((o) => o.label === outcomeLabel);
  const market = pick.market.find((o) => o.label === outcomeLabel);
  if (!ai || !market) return null;
  return {
    pickId: pick.id,
    kind: "market",
    title: pick.title,
    meta: `${pick.categoryEmoji} ${pick.category}`,
    outcomeLabel,
    marketProb: market.price,
    aiProb: ai.probability,
  };
}

export function loadSlip(): SlipLeg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSlip(legs: SlipLeg[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legs));
  } catch {
    // Best effort only.
  }
}

export interface CombinedSlip {
  marketProb: number;
  aiProb: number;
  edge: number;
}

// A parlay's true probability is the product of each leg's independent probability — this is
// standard combinatorics, not something either side of the comparison "agrees" or "disagrees"
// on: if the legs are independent events, P(all hit) = product of each P(hit). Holds regardless
// of whether a leg came from a football match or any other kind of market.
export function combineSlip(legs: SlipLeg[]): CombinedSlip {
  const marketProb = legs.reduce((p, leg) => p * leg.marketProb, 1);
  const aiProb = legs.reduce((p, leg) => p * leg.aiProb, 1);
  return { marketProb, aiProb, edge: aiProb - marketProb };
}

export function legEdge(leg: SlipLeg): number {
  return leg.aiProb - leg.marketProb;
}

import type { SavedPick } from "./types";

const STORAGE_KEY = "betintelligence.slip.v1";

export type Outcome = "home" | "draw" | "away";

export interface SlipLeg {
  pickId: string;
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  leagueFlag: string;
  startTime: string;
  outcome: Outcome;
  marketProb: number;
  aiProb: number;
}

export function legFromPick(pick: SavedPick, outcome: Outcome): SlipLeg {
  return {
    pickId: pick.id,
    homeTeam: pick.homeTeam,
    awayTeam: pick.awayTeam,
    leagueName: pick.leagueName,
    leagueFlag: pick.leagueFlag,
    startTime: pick.startTime,
    outcome,
    marketProb: pick.market[outcome],
    aiProb: pick.independent[outcome],
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

export function outcomeLabel(leg: Pick<SlipLeg, "homeTeam" | "awayTeam" | "outcome">): string {
  if (leg.outcome === "draw") return "Draw";
  return leg.outcome === "home" ? leg.homeTeam : leg.awayTeam;
}

export interface CombinedSlip {
  marketProb: number;
  aiProb: number;
  edge: number;
}

// A parlay's true probability is the product of each leg's independent probability — this is
// standard combinatorics, not something either side of the comparison "agrees" or "disagrees"
// on: if the legs are independent events, P(all hit) = product of each P(hit).
export function combineSlip(legs: SlipLeg[]): CombinedSlip {
  const marketProb = legs.reduce((p, leg) => p * leg.marketProb, 1);
  const aiProb = legs.reduce((p, leg) => p * leg.aiProb, 1);
  return { marketProb, aiProb, edge: aiProb - marketProb };
}

export function legEdge(leg: SlipLeg): number {
  return leg.aiProb - leg.marketProb;
}

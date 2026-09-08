import type { SavedPick, SavedMarketPick, LeagueId, OutcomeTokenIds, Probabilities } from "./types";
import { leagueIdByName } from "./leagues";

// Whether `outcome` is the match's own biggest favorite — the highest market probability among
// the three genuine 1X2 outcomes. Never true for a double-chance combo (not a valid input here at
// all — a combo is definitionally more likely than either side it covers, so by this same
// definition it would trivially always "be the favorite" without actually being what the market
// picked, which is exactly the case lib/riskModes.ts's favoriteOnly tiers exist to exclude).
// Lives here rather than in riskModes.ts (which already imports SlipLeg/Outcome from this file)
// purely to avoid a circular import — riskModes.ts re-exports it as the single home for every
// risk-classification concept.
export function isMarketFavorite(market: Probabilities, outcome: "home" | "draw" | "away"): boolean {
  return market[outcome] >= market.home && market[outcome] >= market.draw && market[outcome] >= market.away;
}

// v2: legs now carry a resolved title/meta/outcomeLabel directly instead of a fixed
// home/draw/away enum plus raw match fields, so a leg can come from either a football pick or
// any Discover market pick. Old v1 slips (pre-unification) are simply orphaned rather than
// migrated — this is local paper-trading data, not anything worth a migration path for.
const STORAGE_KEY = "betintelligence.slip.v2";

// "1x"/"x2" are double-chance combos (home-or-draw, draw-or-away) — not a fourth/fifth
// independent outcome, just two of the three 1X2 outcomes bet together. There is no "12"
// (home-or-away) leg since Polymarket's own partner-league markets don't offer one and the app
// only surfaces combos a real book actually prices.
export type Outcome = "home" | "draw" | "away" | "1x" | "x2";

export interface SlipLeg {
  pickId: string;
  kind: "sports" | "market";
  title: string; // "Arsenal v Chelsea" for sports, the market question for a market pick
  meta: string; // "🏴 Premier League" for sports, "💼 Business" for a market pick
  outcomeLabel: string; // "Arsenal" / "Draw" / "Chelsea" / "1X" / "X2", or the chosen market outcome's label
  marketProb: number;
  aiProb: number;
  // The CLOB token this leg's price can be looked up by later (Home's mark-to-market repricing,
  // lib/portfolioHistory.ts). Null for a double-chance combo (no single token prices "1X") or when
  // the underlying pick predates this field — those legs just hold at their entry value instead.
  tokenId?: string | null;
  // Real-world match identity for a football leg — absent for a market pick (no equivalent
  // concept) and for any leg placed before settlement existed. This is what lets a leg be checked
  // against football-data.org's confirmed result later (lib/settlement.ts); nothing else on this
  // leg (title is a display string, outcomeLabel a free-form team/combo name) is reliable enough
  // to look a match up by.
  league?: LeagueId;
  homeTeam?: string;
  awayTeam?: string;
  startTime?: string;
  // All three outcomes' tokens for this leg's underlying match (not just the one backed) —
  // needed to read the market's OWN post-match verdict for settlement (lib/settlement.ts: whichever
  // side is currently priced highest). `tokenId` above only ever carries the backed side's token,
  // which isn't enough to compare it against the other two.
  tokenIds?: OutcomeTokenIds;
  // Whether this leg's own outcome was the match's biggest favorite at the moment it was added —
  // never true for a double-chance combo (see isMarketFavorite above), always undefined for a
  // market (non-football) leg, which has no such concept, and undefined for any leg placed before
  // this field existed. lib/riskModes.ts's riskModeFor treats a missing value as "not the
  // favorite" — the conservative default, since it can only ever push a leg into a wider tier it
  // definitely still qualifies for, never wrongly grant it a narrower favorite-only one it might
  // not actually have earned.
  isFavorite?: boolean;
}

export function legFromPick(pick: SavedPick, outcome: Outcome): SlipLeg {
  const base = {
    pickId: pick.id,
    kind: "sports" as const,
    title: `${pick.homeTeam} v ${pick.awayTeam}`,
    meta: `${pick.leagueFlag} ${pick.leagueName}`,
    league: leagueIdByName(pick.leagueName),
    homeTeam: pick.homeTeam,
    awayTeam: pick.awayTeam,
    startTime: pick.startTime,
    tokenIds: pick.tokenIds,
  };

  // Double chance is just the sum of the two 1X2 outcomes it covers — both sides (mutually
  // exclusive, exhaustive with the third) sum to the true probability of "either one hits". There
  // is no single CLOB token for a combo, so it isn't repriceable later.
  if (outcome === "1x") {
    return {
      ...base,
      outcomeLabel: "1X",
      marketProb: pick.market.home + pick.market.draw,
      aiProb: pick.independent.home + pick.independent.draw,
      tokenId: null,
      isFavorite: false,
    };
  }
  if (outcome === "x2") {
    return {
      ...base,
      outcomeLabel: "X2",
      marketProb: pick.market.draw + pick.market.away,
      aiProb: pick.independent.draw + pick.independent.away,
      tokenId: null,
      isFavorite: false,
    };
  }

  return {
    ...base,
    outcomeLabel: outcome === "draw" ? "Draw" : outcome === "home" ? pick.homeTeam : pick.awayTeam,
    marketProb: pick.market[outcome],
    aiProb: pick.independent[outcome],
    tokenId: pick.tokenIds?.[outcome] ?? null,
    isFavorite: isMarketFavorite(pick.market, outcome),
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
    tokenId: market.tokenId ?? null,
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

import type { SlipLeg, CombinedSlip } from "./betslip";

// A "placed" bet is a snapshot of the slip at the moment you tapped Buy — legs plus the combined
// market/AI read at that instant. This is deliberately a separate store from the live slip
// (lib/betslip.ts) — placing a bet clears the slip, so the two never overlap.
const STORAGE_KEY = "betintelligence.placedBets.v1";
const MAX_ENTRIES = 100;

// Once a bet is settled (lib/settlement.ts, using football-data.org's confirmed result as ground
// truth for football legs), that outcome is final and never recomputed — a later poll seeing
// stale or missing provider data must not un-settle a bet that already resolved. A bet with any
// non-football (market) leg can never reach this: there's no resolution source for those, so it
// just stays unsettled forever, same as before settlement existed at all.
export interface BetSettlement {
  status: "won" | "lost";
  payout: number;
  settledAt: string;
}

export interface PlacedBet {
  id: string;
  placedAt: string;
  legs: SlipLeg[];
  combined: CombinedSlip;
  // Paper stake in EUR, spent from the Home portfolio's cash balance when this bet was placed.
  // Bets placed before this field existed won't have it — callers should treat a missing value as
  // DEFAULT_STAKE (lib/portfolio.ts) rather than crash or show "€undefined".
  stake: number;
  settlement?: BetSettlement;
}

export function loadPlacedBets(): PlacedBet[] {
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

function persist(bets: PlacedBet[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
  } catch {
    // Best effort only.
  }
}

export function placeBet(legs: SlipLeg[], combined: CombinedSlip, stake: number): PlacedBet {
  const bet: PlacedBet = {
    id: `bet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    placedAt: new Date().toISOString(),
    legs,
    combined,
    stake,
  };
  const next = [bet, ...loadPlacedBets()].slice(0, MAX_ENTRIES);
  persist(next);
  return bet;
}

export function removePlacedBet(id: string): PlacedBet[] {
  const next = loadPlacedBets().filter((b) => b.id !== id);
  persist(next);
  return next;
}

// Merges freshly-determined settlements into storage. Never overwrites a bet that already has a
// settlement — once won/lost is known, it's final, so a bet not present in `updates` (still
// unresolved, or already settled) simply passes through unchanged.
export function applySettlements(updates: Record<string, { status: "won" | "lost"; payout: number }>): PlacedBet[] {
  const bets = loadPlacedBets();
  let changed = false;
  const next = bets.map((bet) => {
    if (bet.settlement) return bet;
    const update = updates[bet.id];
    if (!update) return bet;
    changed = true;
    return { ...bet, settlement: { ...update, settledAt: new Date().toISOString() } };
  });
  if (changed) persist(next);
  return next;
}

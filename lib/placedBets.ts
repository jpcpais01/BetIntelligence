import type { SlipLeg, CombinedSlip } from "./betslip";

// A "placed" bet is a snapshot of the slip at the moment you tapped Buy — legs plus the combined
// market/AI read at that instant. Nothing here settles a bet (win/loss/payout): the app has no
// mechanism to know how a match or market actually resolved, so a placed bet just sits as a
// permanent paper-trade record, same spirit as everywhere else in the app ("saving a pick" never
// implied real money either). This is deliberately a separate store from the live slip
// (lib/betslip.ts) — placing a bet clears the slip, so the two never overlap.
const STORAGE_KEY = "betintelligence.placedBets.v1";
const MAX_ENTRIES = 100;

export interface PlacedBet {
  id: string;
  placedAt: string;
  legs: SlipLeg[];
  combined: CombinedSlip;
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

export function placeBet(legs: SlipLeg[], combined: CombinedSlip): PlacedBet {
  const bet: PlacedBet = {
    id: `bet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    placedAt: new Date().toISOString(),
    legs,
    combined,
  };
  const next = [bet, ...loadPlacedBets()].slice(0, MAX_ENTRIES);
  persist(next);
  return bet;
}

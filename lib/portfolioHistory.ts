import type { Deposit } from "./portfolio";
import { totalDeposited } from "./portfolio";
import type { PlacedBet } from "./placedBets";
import type { SlipLeg } from "./betslip";
import type { HistoryPoint } from "./oddsHistory";
import { liveKey } from "./livePrices";

// Matches the 7-day window /api/odds-history itself fetches — the portfolio graph can't show
// price-driven movement further back than the underlying price data goes anyway.
export const GRAPH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface PortfolioPoint {
  t: number;
  value: number;
}

// The point with the largest timestamp at or before `t` — i.e. "the price as of t", not an
// interpolation. Before any known point (or with no series at all), holds at `fallback`, which
// callers pass as the leg's own entry price — so an unrepriceable leg just contributes its
// original stake, never a fabricated number.
function priceAt(points: HistoryPoint[] | undefined, t: number, fallback: number): number {
  if (!points || points.length === 0) return fallback;
  let best: { pt: number; p: number } | null = null;
  for (const point of points) {
    const pt = new Date(point.t).getTime();
    if (pt <= t && (best === null || pt > best.pt)) best = { pt, p: point.p };
  }
  return best ? best.p : fallback;
}

// A parlay's mark-to-market multiplier is the product of each leg's own price-now / price-at-entry
// ratio — the same "buy a share at p0, it's worth p1 now" math a real prediction-market position
// uses, generalized across every leg in the bet.
function legMultiplierAt(leg: SlipLeg, priceSeriesByKey: Record<string, HistoryPoint[]>, t: number): number {
  if (leg.marketProb <= 0) return 1;
  const key = liveKey(leg.pickId, leg.outcomeLabel);
  const current = priceAt(priceSeriesByKey[key], t, leg.marketProb);
  return current / leg.marketProb;
}

// Current (or as-of-`t`) mark-to-market value of one placed bet, in the same currency as its
// stake. Exported for the Recent Bets list, which shows each bet's own live value/P&L rather than
// just the aggregate portfolio number. Once a bet is settled (lib/settlement.ts), its value is no
// longer a market-price estimate — it's the real, final payout, frozen from the moment it
// resolved onward. A timestamp before that moment still shows the mark-to-market path exactly as
// it looked at the time, so a historical portfolio graph doesn't rewrite its own past.
export function computeBetValue(bet: PlacedBet, priceSeriesByKey: Record<string, HistoryPoint[]>, t: number): number {
  if (bet.settlement) {
    const settledAt = new Date(bet.settlement.settledAt).getTime();
    if (t >= settledAt) return bet.settlement.payout;
  }
  const multiplier = bet.legs.reduce((prod, leg) => prod * legMultiplierAt(leg, priceSeriesByKey, t), 1);
  return bet.stake * multiplier;
}

// Reconstructs portfolio value over time: a flat baseline (every deposit summed as if it all
// happened before the graph even starts — see lib/portfolio.ts) plus, from each bet's own
// placement moment onward, that bet's mark-to-market value in place of its stake. Deposits never
// appear as a jump; only price movement of open positions moves the line above/below the
// baseline.
export function buildPortfolioSeries(
  deposits: Deposit[],
  bets: PlacedBet[],
  priceSeriesByKey: Record<string, HistoryPoint[]>,
  now: number = Date.now()
): PortfolioPoint[] {
  const baseline = totalDeposited(deposits);
  const windowStart = now - GRAPH_WINDOW_MS;

  const timestamps = new Set<number>([windowStart, now]);
  for (const bet of bets) {
    const placedAt = new Date(bet.placedAt).getTime();
    if (placedAt >= windowStart && placedAt <= now) timestamps.add(placedAt);
  }
  for (const points of Object.values(priceSeriesByKey)) {
    for (const point of points) {
      const pt = new Date(point.t).getTime();
      if (pt >= windowStart && pt <= now) timestamps.add(pt);
    }
  }

  return [...timestamps].sort((a, b) => a - b).map((t) => {
    const activeBets = bets.filter((b) => new Date(b.placedAt).getTime() <= t);
    const stakedSoFar = activeBets.reduce((sum, b) => sum + b.stake, 0);
    const positionsValue = activeBets.reduce((sum, b) => sum + computeBetValue(b, priceSeriesByKey, t), 0);
    return { t, value: baseline - stakedSoFar + positionsValue };
  });
}

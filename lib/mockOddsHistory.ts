import type { HistoryPoint } from "./oddsHistory";
import type { HistoryWindow } from "./oddsHistoryServer";

// Mirrors the real per-window resolution (lib/oddsHistoryServer.ts's WINDOW_CONFIG) so mock mode
// demonstrates the same "3h is finer than 1d is finer than 7d" behavior without hitting CLOB —
// point count is just window span / bucket size, same relationship the real fidelity param has.
const WINDOW_SPAN_MS: Record<HistoryWindow, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
};
const WINDOW_POINT_COUNT: Record<HistoryWindow, number> = {
  "7d": 40,
  "1d": 48,
  "3h": 36,
};

// Deterministic PRNG (mulberry32) seeded from the outcome's own label, so the same outcome
// always renders the same synthetic trend across repeated dropdown opens in mock mode, without
// needing any server-side state.
function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Walks backward from today's real price so the series always lands exactly on the price the
// card is already showing, then reverses — a fabricated history that at least agrees with the
// one real number the app actually knows. `now` is injectable (defaults to the real clock) so a
// test can assert determinism without two calls racing across a millisecond boundary.
export function generateMockHistory(
  label: string,
  currentPrice: number,
  now: number = Date.now(),
  window: HistoryWindow = "7d"
): HistoryPoint[] {
  const rand = mulberry32(seedFromString(label));
  const windowMs = WINDOW_SPAN_MS[window];
  const pointCount = WINDOW_POINT_COUNT[window];
  const start = now - windowMs;
  const step = windowMs / (pointCount - 1);

  const prices: number[] = [Math.min(0.97, Math.max(0.03, currentPrice))];
  for (let i = 1; i < pointCount; i++) {
    const drift = (rand() - 0.5) * 0.06;
    const prev = prices[prices.length - 1];
    prices.push(Math.min(0.97, Math.max(0.03, prev - drift)));
  }
  prices.reverse();

  return prices.map((p, i) => ({
    t: new Date(start + step * i).toISOString(),
    p: Math.round(p * 1000) / 1000,
  }));
}

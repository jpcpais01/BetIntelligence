import { NextRequest, NextResponse } from "next/server";
import { fetchMidpoints } from "@/lib/oddsHistoryServer";

// A handful of parallel CLOB requests, each normally near-instant — the whole point of this route
// over /api/odds-history is that it never waits on a bucketed candle.
export const maxDuration = 20;

// Deterministic per-label jitter so mock mode still shows the odds bar visibly ticking every poll,
// without needing a real CLOB connection — same seeding idea as lib/mockOddsHistory.ts, just a
// single point instead of a whole series.
function mockPrice(label: string, current: number, now: number): number {
  let h = 2166136261;
  const seed = `${label}:${Math.floor(now / 1000)}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = (h >>> 0) / 4294967296;
  const jitter = (rand - 0.5) * 0.02;
  return Math.round(Math.min(0.97, Math.max(0.03, current + jitter)) * 1000) / 1000;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const labels = searchParams.getAll("label");
  const tokens = searchParams.getAll("token");
  const currents = searchParams.getAll("current").map((v) => parseFloat(v));

  if (labels.length === 0 || labels.length !== tokens.length) {
    return NextResponse.json({ prices: [] }, { status: 400 });
  }

  if (process.env.MOCK_GAMES === "1" || process.env.MOCK_MARKETS === "1") {
    const now = Date.now();
    const prices = labels.map((label, i) => ({
      label,
      price: mockPrice(label, Number.isFinite(currents[i]) ? currents[i] : 0.5, now),
    }));
    return NextResponse.json({ prices });
  }

  const outcomes = labels.map((label, i) => ({ label, tokenId: tokens[i] ? tokens[i] : null }));

  try {
    const prices = await fetchMidpoints(outcomes, fetch);
    return NextResponse.json({ prices });
  } catch (err) {
    console.error("GET /api/live-odds failed", err);
    return NextResponse.json({ prices: outcomes.map((o) => ({ label: o.label, price: null })) });
  }
}

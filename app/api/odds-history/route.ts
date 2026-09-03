import { NextRequest, NextResponse } from "next/server";
import { fetchHistorySeries } from "@/lib/oddsHistoryServer";
import { generateMockHistory } from "@/lib/mockOddsHistory";

// A handful of parallel CLOB requests, each usually fast, but thin/rate-limited responses can
// still take a moment.
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const labels = searchParams.getAll("label");
  const tokens = searchParams.getAll("token");
  const currents = searchParams.getAll("current").map((v) => parseFloat(v));

  if (labels.length === 0 || labels.length !== tokens.length) {
    return NextResponse.json({ series: [] }, { status: 400 });
  }

  if (process.env.MOCK_GAMES === "1" || process.env.MOCK_MARKETS === "1") {
    const series = labels.map((label, i) => ({
      label,
      points: generateMockHistory(label, Number.isFinite(currents[i]) ? currents[i] : 0.5),
    }));
    return NextResponse.json({ series });
  }

  const outcomes = labels.map((label, i) => ({
    label,
    tokenId: tokens[i] ? tokens[i] : null,
  }));

  try {
    const series = await fetchHistorySeries(outcomes);
    return NextResponse.json({ series });
  } catch (err) {
    console.error("GET /api/odds-history failed", err);
    return NextResponse.json({ series: outcomes.map((o) => ({ label: o.label, points: [] })) });
  }
}

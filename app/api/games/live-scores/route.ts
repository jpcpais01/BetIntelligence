import { NextResponse } from "next/server";
import { getLiveScores } from "@/lib/footballData";

// Polled frequently (see app/sports/page.tsx) while there's a plausibly-live match on screen, so
// this stays a separate, lightweight route rather than folding into /api/games' own 30-minute
// odds refresh — a real score is only useful if it's actually fresh.
export const maxDuration = 90;

export async function GET() {
  // Mock games carry synthetic kickoff times but real club names (Arsenal, Real Madrid, ...) —
  // matching them against real live fixtures would attach a real score to a made-up match.
  if (process.env.MOCK_GAMES === "1") {
    return NextResponse.json({ liveScores: [] });
  }

  try {
    const liveScores = await getLiveScores();
    return NextResponse.json({ liveScores });
  } catch (err) {
    console.error("GET /api/games/live-scores failed", err);
    // Best-effort enrichment — an empty list just means cards fall back to their existing
    // kickoff-based label with no score, not a broken page.
    return NextResponse.json({ liveScores: [] });
  }
}

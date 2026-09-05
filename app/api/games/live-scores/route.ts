import { NextResponse } from "next/server";
import { getLiveScores } from "@/lib/liveScores";
import { isLeagueId } from "@/lib/leagues";
import type { LeagueId } from "@/lib/types";

// Polled frequently (see app/sports/page.tsx) while there's a plausibly-live match on screen, so
// this stays a separate, lightweight route rather than folding into /api/games' own 30-minute
// odds refresh — a real score is only useful if it's actually fresh.
export const maxDuration = 90;

function parseLeagues(body: unknown): LeagueId[] {
  const leagues = (body as { leagues?: unknown } | null)?.leagues;
  if (!Array.isArray(leagues)) return [];
  return leagues.filter(isLeagueId);
}

export async function POST(request: Request) {
  // Mock games carry synthetic kickoff times but real club names (Arsenal, Real Madrid, ...) —
  // matching them against real live fixtures would attach a real score to a made-up match.
  if (process.env.MOCK_GAMES === "1") {
    return NextResponse.json({ liveScores: [] });
  }

  try {
    const body = await request.json();
    const leagues = parseLeagues(body);
    if (leagues.length === 0) return NextResponse.json({ liveScores: [] });

    const liveScores = await getLiveScores(leagues);
    return NextResponse.json({ liveScores });
  } catch (err) {
    console.error("POST /api/games/live-scores failed", err);
    // Best-effort enrichment — an empty list just means cards fall back to their existing
    // kickoff-based label with no score, not a broken page.
    return NextResponse.json({ liveScores: [] });
  }
}

import { NextResponse } from "next/server";
import { getMatchResultsSince } from "@/lib/footballData";
import { isLeagueId } from "@/lib/leagues";
import type { LeagueId } from "@/lib/types";

// Called from Home/Lab whenever there's a still-open placed bet with football legs — unlike
// /api/games/live-scores (tight ±1 day window for "what's on screen right now"), this looks back
// as far as each league's oldest still-unsettled bet needs, so a bet that finished days ago and
// simply hasn't been checked since still settles the next time the app is opened.
export const maxDuration = 90;

interface RefInput {
  league?: unknown;
  earliestKickoff?: unknown;
}

function parseRefs(body: unknown): { league: LeagueId; earliestKickoff: string }[] {
  const refs = (body as { refs?: unknown } | null)?.refs;
  if (!Array.isArray(refs)) return [];
  return refs
    .map((r: RefInput) => r)
    .filter(
      (r): r is { league: LeagueId; earliestKickoff: string } =>
        isLeagueId(r?.league) && typeof r?.earliestKickoff === "string"
    );
}

export async function POST(request: Request) {
  // Mock games carry synthetic kickoff times but real club names — matching them against real
  // finished fixtures would settle a paper bet on a match that never actually happened.
  if (process.env.MOCK_GAMES === "1") {
    return NextResponse.json({ scores: [] });
  }

  try {
    const body = await request.json();
    const refs = parseRefs(body);
    if (refs.length === 0) return NextResponse.json({ scores: [] });

    const scores = await getMatchResultsSince(refs);
    return NextResponse.json({ scores });
  } catch (err) {
    console.error("POST /api/bets/settlement-scores failed", err);
    // Best-effort — an empty list just means nothing settles this round, not a broken page.
    return NextResponse.json({ scores: [] });
  }
}

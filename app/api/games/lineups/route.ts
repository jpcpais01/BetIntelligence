import { NextResponse } from "next/server";
import { getLineupAvailability } from "@/lib/lineups";
import { isLeagueId } from "@/lib/leagues";
import type { LeagueId } from "@/lib/types";

// Polled every few minutes for whichever games are getting close to kickoff (see app/sports/page.tsx)
// — a separate lightweight route rather than folding into /api/games, since this is purely "has a
// lineup shown up yet", not anything to do with odds.
export const maxDuration = 60;

interface LineupCheck {
  id: string;
  league: LeagueId;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
}

function parseGames(body: unknown): LineupCheck[] {
  const games = (body as { games?: unknown } | null)?.games;
  if (!Array.isArray(games)) return [];
  return games.filter(
    (g): g is LineupCheck =>
      !!g &&
      typeof g.id === "string" &&
      isLeagueId(g.league) &&
      typeof g.homeTeam === "string" &&
      typeof g.awayTeam === "string" &&
      typeof g.startTime === "string"
  );
}

export async function POST(request: Request) {
  // Mock games carry synthetic ids/kickoff times but real club names — matching them against real
  // ESPN fixtures would attach a real lineup to a made-up match, the same reasoning live-scores'
  // MOCK_GAMES guard already documents.
  if (process.env.MOCK_GAMES === "1") {
    return NextResponse.json({ ready: {} });
  }

  try {
    const body = await request.json();
    const games = parseGames(body);
    if (games.length === 0) return NextResponse.json({ ready: {} });

    const ready = await getLineupAvailability(games);
    return NextResponse.json({ ready });
  } catch (err) {
    console.error("POST /api/games/lineups failed", err);
    // Best-effort enrichment — cards just keep showing no lineup badge yet, not a broken page.
    return NextResponse.json({ ready: {} });
  }
}

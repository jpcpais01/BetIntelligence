import { NextResponse } from "next/server";
import { fetchLiveOdds } from "@/lib/polymarket";
import { isLeagueId } from "@/lib/leagues";
import type { LeagueId } from "@/lib/types";

// Polled every 5 seconds (see app/sports/page.tsx) for whichever games are currently live — kept
// bounded to one page per distinct league among them, not a full sweep, so this stays cheap
// enough for that cadence.
export const maxDuration = 30;

interface GameRef {
  id: string;
  league: LeagueId;
}

function parseGameRefs(body: unknown): GameRef[] {
  const games = (body as { games?: unknown } | null)?.games;
  if (!Array.isArray(games)) return [];

  const refs: GameRef[] = [];
  for (const g of games) {
    if (!g || typeof g !== "object") continue;
    const id = (g as { id?: unknown }).id;
    const league = (g as { league?: unknown }).league;
    if (typeof id === "string" && id.length > 0 && isLeagueId(league)) {
      refs.push({ id, league });
    }
  }
  return refs;
}

export async function POST(request: Request) {
  // Mock games have no real Polymarket ids to look up live odds for.
  if (process.env.MOCK_GAMES === "1") {
    return NextResponse.json({ odds: {} });
  }

  try {
    const body = await request.json();
    const refs = parseGameRefs(body);
    if (refs.length === 0) return NextResponse.json({ odds: {} });

    const odds = await fetchLiveOdds(refs);
    return NextResponse.json({ odds });
  } catch (err) {
    console.error("POST /api/games/live-odds failed", err);
    // Best-effort enrichment — an empty result just means cards keep showing whatever odds they
    // already had, not a broken page.
    return NextResponse.json({ odds: {} });
  }
}

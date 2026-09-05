import { NextResponse } from "next/server";
import { debugFetchLeagueInjuries } from "@/lib/bigBallsData";
import { isLeagueId } from "@/lib/leagues";

export const maxDuration = 30;

// Not linked from the UI. Hit this directly (e.g. /api/debug/injuries?league=premier-league) to
// see the RAW responses Big Balls Sports Data actually returns for a league's injuries AND its
// team-name lookup — this provider's exact response shape wasn't fully verifiable ahead of time
// (its domain is blocked by this project's dev sandbox network policy), so this is how a real
// shape or auth mismatch gets diagnosed instead of guessed at again.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const league = searchParams.get("league");

  if (!isLeagueId(league)) {
    return NextResponse.json(
      {
        error: "Pass a valid ?league= query param.",
        example: "/api/debug/injuries?league=premier-league",
        validLeagues: ["premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1", "champions-league"],
      },
      { status: 400 }
    );
  }

  const result = await debugFetchLeagueInjuries(league);
  return NextResponse.json(result);
}

import { NextResponse } from "next/server";
import { getUpcomingGames } from "@/lib/polymarket";
import { getMockGames } from "@/lib/mockGames";

// A cold sweep across all league tags is many sequential/rate-limited-retried requests.
export const maxDuration = 60;

export async function GET() {
  try {
    const games =
      process.env.MOCK_GAMES === "1" ? getMockGames() : await getUpcomingGames();
    return NextResponse.json({ games });
  } catch (err) {
    console.error("GET /api/games failed", err);
    return NextResponse.json(
      { error: "Could not load games from Polymarket right now." },
      { status: 502 }
    );
  }
}

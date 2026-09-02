import { NextResponse } from "next/server";
import { getUpcomingGames } from "@/lib/polymarket";
import { getMockGames } from "@/lib/mockGames";

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

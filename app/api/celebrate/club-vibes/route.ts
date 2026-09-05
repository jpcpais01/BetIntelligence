import { NextResponse } from "next/server";
import { getClubVibes, getMockClubVibes } from "@/lib/clubVibe";

// A small, fast, one-off call — nothing here needs the 300s ceiling the real analysis routes do.
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const teamNames = Array.isArray(body?.teamNames)
      ? body.teamNames.filter((t: unknown): t is string => typeof t === "string" && t.length > 0)
      : [];
    if (teamNames.length === 0) return NextResponse.json({ error: "Missing teamNames." }, { status: 400 });

    const vibes = process.env.MOCK_AI === "1" ? getMockClubVibes(teamNames) : await getClubVibes(teamNames);
    // A null result (rate limit, a malformed reply) is a normal, expected outcome for this
    // best-effort flourish — 200 with vibes:null, never an error status, so the caller just
    // quietly skips the celebration rather than treating it as a failed request.
    return NextResponse.json({ vibes });
  } catch (err) {
    console.error("POST /api/celebrate/club-vibes failed", err);
    return NextResponse.json({ vibes: null });
  }
}

import { NextResponse } from "next/server";
import { getClubVibe, getMockClubVibe } from "@/lib/clubVibe";

// A small, fast, one-off call — nothing here needs the 300s ceiling the real analysis routes do.
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const clubName = typeof body?.clubName === "string" ? body.clubName.trim() : "";
    if (!clubName) return NextResponse.json({ error: "Missing clubName." }, { status: 400 });

    const vibe = process.env.MOCK_AI === "1" ? getMockClubVibe() : await getClubVibe(clubName);
    // A null vibe (rate limit, an unrecognized club, a malformed reply) is a normal, expected
    // outcome for this best-effort flourish — 200 with vibe:null, never an error status, so the
    // caller just quietly skips the celebration rather than treating it as a failed request.
    return NextResponse.json({ vibe });
  } catch (err) {
    console.error("POST /api/celebrate/club-vibe failed", err);
    return NextResponse.json({ vibe: null });
  }
}

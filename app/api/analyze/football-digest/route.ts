import { NextResponse } from "next/server";
import { buildFootballAnalysisDigest } from "@/lib/openrouter";
import { getMockFootballDigest } from "@/lib/mockAnalysis";
import { isLeagueId } from "@/lib/leagues";

// Fetches the football-data.org + Big Balls Data research digest exactly once per match, so the
// research-runs stepper (AnalysisSheet.tsx) can fire N parallel /api/analyze/predict calls that
// all reuse this one digest instead of each independently re-deriving it — see the comment on
// buildFootballAnalysisDigest in lib/openrouter.ts for why that's a real, not cosmetic, fix.
export const maxDuration = 90;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { homeTeam, awayTeam, league, startTime } = body ?? {};

    if (!homeTeam || !awayTeam || !startTime) {
      return NextResponse.json({ error: "Missing match details." }, { status: 400 });
    }
    if (!isLeagueId(league)) {
      return NextResponse.json({ error: "Unknown or missing league." }, { status: 400 });
    }

    const digest =
      process.env.MOCK_AI === "1"
        ? await getMockFootballDigest({ homeTeam, awayTeam })
        : await buildFootballAnalysisDigest({ homeTeam, awayTeam, league, startTime });

    return NextResponse.json({
      digest: digest.text,
      homeStanding: digest.homeStanding,
      awayStanding: digest.awayStanding,
      homeInjuries: digest.homeInjuries,
      awayInjuries: digest.awayInjuries,
    });
  } catch (err) {
    console.error("POST /api/analyze/football-digest failed", err);
    const message = err instanceof Error ? err.message : "Could not build the research digest.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

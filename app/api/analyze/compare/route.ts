import { NextResponse } from "next/server";
import { compareToMarket } from "@/lib/openrouter";
import { getMockComparison } from "@/lib/mockAnalysis";
import type { IndependentPrediction, Probabilities } from "@/lib/types";

// Retries mean this can outlive a default serverless timeout too.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { homeTeam, awayTeam, leagueName, independent, market } = body ?? {};

    if (!homeTeam || !awayTeam || !leagueName || !independent || !market) {
      return NextResponse.json({ error: "Missing analysis details." }, { status: 400 });
    }

    const comparison =
      process.env.MOCK_AI === "1"
        ? await getMockComparison({
            independent: independent as IndependentPrediction,
            market: market as Probabilities,
          })
        : await compareToMarket({
            homeTeam,
            awayTeam,
            leagueName,
            independent: independent as IndependentPrediction,
            market: market as Probabilities,
          });

    return NextResponse.json({ comparison });
  } catch (err) {
    console.error("POST /api/analyze/compare failed", err);
    const message = err instanceof Error ? err.message : "AI comparison failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

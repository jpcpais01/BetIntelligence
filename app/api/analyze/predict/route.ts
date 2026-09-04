import { NextResponse } from "next/server";
import { getIndependentPrediction } from "@/lib/openrouter";
import { getMockIndependentPrediction } from "@/lib/mockAnalysis";
import { resolveOpenRouterModel } from "@/lib/models";
import { isLeagueId } from "@/lib/leagues";

// 300s is Vercel's hard ceiling for a Serverless Function on the Pro plan without Fluid Compute
// enabled (Hobby caps at 60s) — going higher doesn't buy more time, it just makes every deployment
// fail with an unhelpful blank "Error" once Vercel tries to provision the function and rejects the
// value against the plan limit.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { homeTeam, awayTeam, leagueName, league, startTime, model } = body ?? {};

    if (!homeTeam || !awayTeam || !leagueName || !startTime) {
      return NextResponse.json({ error: "Missing match details." }, { status: 400 });
    }
    if (!isLeagueId(league)) {
      return NextResponse.json({ error: "Unknown or missing league." }, { status: 400 });
    }

    const prediction =
      process.env.MOCK_AI === "1"
        ? await getMockIndependentPrediction({ homeTeam, awayTeam })
        : await getIndependentPrediction({
            homeTeam,
            awayTeam,
            leagueName,
            league,
            startTime,
            model: resolveOpenRouterModel(model),
          });

    return NextResponse.json({ prediction });
  } catch (err) {
    console.error("POST /api/analyze/predict failed", err);
    const message = err instanceof Error ? err.message : "AI analysis failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

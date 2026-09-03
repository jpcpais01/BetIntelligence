import { NextResponse } from "next/server";
import { getIndependentPrediction } from "@/lib/openrouter";
import { getMockIndependentPrediction } from "@/lib/mockAnalysis";
import { resolveOpenRouterModel } from "@/lib/models";

// This now runs two sequential OpenRouter calls (a web-search research pass, then an offline
// predict pass), each with its own retry budget — worst case is roughly double a single call's,
// so the timeout budget doubles too.
export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { homeTeam, awayTeam, leagueName, startTime, model } = body ?? {};

    if (!homeTeam || !awayTeam || !leagueName || !startTime) {
      return NextResponse.json({ error: "Missing match details." }, { status: 400 });
    }

    const prediction =
      process.env.MOCK_AI === "1"
        ? await getMockIndependentPrediction({ homeTeam, awayTeam })
        : await getIndependentPrediction({
            homeTeam,
            awayTeam,
            leagueName,
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

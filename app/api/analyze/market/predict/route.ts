import { NextResponse } from "next/server";
import { getIndependentMarketPrediction } from "@/lib/openrouterMarkets";
import { getMockMarketPrediction } from "@/lib/mockMarketAnalysis";
import { resolveOpenRouterModel } from "@/lib/models";

// This now runs two sequential OpenRouter calls (a web-search research pass, then an offline
// predict pass), each with its own retry budget — worst case is roughly double a single call's,
// so the timeout budget doubles too.
export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, category, endDate, outcomeLabels, model } = body ?? {};

    if (!title || !category || !endDate || !Array.isArray(outcomeLabels) || outcomeLabels.length < 2) {
      return NextResponse.json({ error: "Missing market details." }, { status: 400 });
    }

    const prediction =
      process.env.MOCK_AI === "1"
        ? await getMockMarketPrediction({ title, outcomeLabels })
        : await getIndependentMarketPrediction({
            title,
            category,
            endDate,
            outcomeLabels,
            model: resolveOpenRouterModel(model),
          });

    return NextResponse.json({ prediction });
  } catch (err) {
    console.error("POST /api/analyze/market/predict failed", err);
    const message = err instanceof Error ? err.message : "AI analysis failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

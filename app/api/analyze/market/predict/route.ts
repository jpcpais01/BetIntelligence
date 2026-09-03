import { NextResponse } from "next/server";
import { getIndependentMarketPrediction } from "@/lib/openrouterMarkets";
import { getMockMarketPrediction } from "@/lib/mockMarketAnalysis";

// Web-search-backed research plus retries can run well past a default serverless timeout.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, category, endDate, outcomeLabels } = body ?? {};

    if (!title || !category || !endDate || !Array.isArray(outcomeLabels) || outcomeLabels.length < 2) {
      return NextResponse.json({ error: "Missing market details." }, { status: 400 });
    }

    const prediction =
      process.env.MOCK_AI === "1"
        ? await getMockMarketPrediction({ title, outcomeLabels })
        : await getIndependentMarketPrediction({ title, category, endDate, outcomeLabels });

    return NextResponse.json({ prediction });
  } catch (err) {
    console.error("POST /api/analyze/market/predict failed", err);
    const message = err instanceof Error ? err.message : "AI analysis failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

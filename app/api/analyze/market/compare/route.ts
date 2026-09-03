import { NextResponse } from "next/server";
import { compareMarketToOdds } from "@/lib/openrouterMarkets";
import { getMockMarketComparison } from "@/lib/mockMarketAnalysis";
import type { MarketOutcome, MarketPrediction } from "@/lib/types";
import { resolveOpenRouterModel } from "@/lib/models";

// Retries mean this can outlive a default serverless timeout too.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, category, independent, market, model } = body ?? {};

    if (!title || !category || !independent || !Array.isArray(market) || market.length < 2) {
      return NextResponse.json({ error: "Missing analysis details." }, { status: 400 });
    }

    const comparison =
      process.env.MOCK_AI === "1"
        ? await getMockMarketComparison({
            independent: independent as MarketPrediction,
            market: market as MarketOutcome[],
          })
        : await compareMarketToOdds({
            title,
            category,
            independent: independent as MarketPrediction,
            market: market as MarketOutcome[],
            model: resolveOpenRouterModel(model),
          });

    return NextResponse.json({ comparison });
  } catch (err) {
    console.error("POST /api/analyze/market/compare failed", err);
    const message = err instanceof Error ? err.message : "AI comparison failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

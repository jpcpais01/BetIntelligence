import { NextResponse } from "next/server";
import { getTrendingMarkets } from "@/lib/allMarkets";
import { getMockMarkets } from "@/lib/mockMarkets";

// A multi-page trending sweep across every category on Polymarket.
export const maxDuration = 60;

export async function GET() {
  try {
    const markets =
      process.env.MOCK_MARKETS === "1" ? getMockMarkets() : await getTrendingMarkets();
    return NextResponse.json({ markets });
  } catch (err) {
    console.error("GET /api/markets failed", err);
    return NextResponse.json(
      { error: "Could not load markets from Polymarket right now." },
      { status: 502 }
    );
  }
}

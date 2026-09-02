import { NextResponse } from "next/server";
import { getRawSample } from "@/lib/polymarket";

export const maxDuration = 60;

// Not linked from the UI. Dumps trimmed raw Polymarket event/market data so the actual
// shape of the data can be inspected directly instead of guessed at, when /api/games/debug
// shows events getting dropped somewhere in the parsing pipeline.
export async function GET() {
  try {
    const sample = await getRawSample();
    return NextResponse.json(sample);
  } catch (err) {
    console.error("GET /api/games/raw failed", err);
    const message = err instanceof Error ? err.message : "Raw sample failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

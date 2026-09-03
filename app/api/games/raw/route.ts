import { NextResponse } from "next/server";
import { getRawSample } from "@/lib/polymarket";

export const maxDuration = 60;

// Not linked from the UI. Dumps trimmed raw Polymarket event/market data so the actual
// shape of the data can be inspected directly instead of guessed at, when /api/games/debug
// shows events getting dropped somewhere in the parsing pipeline.
//
// ?slim=1 returns only strategy + partnerLeagueEvents — the full dump includes a titles
// array covering the entire sweep (thousands of entries) which is impractical to paste back
// when the only thing actually needed is what a real premier-league/la-liga/serie-a event's
// raw `series`/`tags` fields look like.
export async function GET(request: Request) {
  try {
    const sample = await getRawSample();
    const slim = new URL(request.url).searchParams.get("slim");
    if (slim) {
      return NextResponse.json({
        strategy: sample.strategy,
        partnerLeagueEvents: sample.partnerLeagueEvents,
      });
    }
    return NextResponse.json(sample);
  } catch (err) {
    console.error("GET /api/games/raw failed", err);
    const message = err instanceof Error ? err.message : "Raw sample failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

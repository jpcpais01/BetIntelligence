import { NextResponse } from "next/server";
import { getFetchDiagnostics } from "@/lib/polymarket";

export const maxDuration = 60;

// Not linked from the UI. Hit this directly (e.g. /api/games/debug) to see how many
// Polymarket events were fetched and at which pipeline stage they got filtered out,
// useful when /api/games is unexpectedly returning zero games.
export async function GET() {
  try {
    const diagnostics = await getFetchDiagnostics();
    return NextResponse.json(diagnostics);
  } catch (err) {
    console.error("GET /api/games/debug failed", err);
    const message = err instanceof Error ? err.message : "Diagnostics failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { getClubLogos } from "@/lib/clubLogos";

export const maxDuration = 60;

export async function GET() {
  try {
    const logos = await getClubLogos();
    const map: Record<string, string> = {};
    for (const { name, logoUrl } of logos) {
      if (logoUrl) map[name] = logoUrl;
    }
    return NextResponse.json(
      { logos: map },
      { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } }
    );
  } catch (err) {
    console.error("GET /api/logos failed", err);
    // A logo failure should never break the app — just return an empty map so every
    // Avatar falls back to its initials, same as a club we never had a logo for.
    return NextResponse.json({ logos: {} });
  }
}

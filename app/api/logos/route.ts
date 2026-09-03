import { NextResponse } from "next/server";
import { getClubLogos, MAX_LOGO_NAMES_PER_REQUEST } from "@/lib/clubLogos";

export const maxDuration = 60;

// POST { names: string[] } -> { logos: Record<name, url> } for whichever of those names have
// a resolvable crest. Every team currently showing anywhere in the app (games, saved picks,
// slip legs) can ask for its own logo this way, rather than being limited to a fixed curated
// list — see ClubLogosProvider, which dedupes against everything already cached before calling.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const names = Array.isArray(body?.names) ? body.names.filter((n: unknown) => typeof n === "string") : [];
    if (names.length === 0) return NextResponse.json({ logos: {} });
    if (names.length > MAX_LOGO_NAMES_PER_REQUEST) {
      return NextResponse.json({ error: "Too many names in one request." }, { status: 400 });
    }

    const logos = await getClubLogos(names);
    const map: Record<string, string> = {};
    for (const { name, logoUrl } of logos) {
      if (logoUrl) map[name] = logoUrl;
    }
    return NextResponse.json({ logos: map });
  } catch (err) {
    console.error("POST /api/logos failed", err);
    // A logo failure should never break the app — just return an empty map so every
    // Avatar falls back to its initials, same as a club we never had a logo for.
    return NextResponse.json({ logos: {} });
  }
}

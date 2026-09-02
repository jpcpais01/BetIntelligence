import { getAllTopTeamNames } from "./topTeams";

// TheSportsDB's shared free test key. Documented for exactly this kind of non-commercial,
// low-volume lookup (searchteams.php by name, returning strBadge as the crest URL).
const SPORTS_DB_BASE = "https://www.thesportsdb.com/api/v1/json/123";

interface RawTeam {
  strTeam?: string;
  strBadge?: string;
  strSport?: string;
}

async function searchTeamBadge(name: string): Promise<string | null> {
  try {
    const res = await fetch(`${SPORTS_DB_BASE}/searchteams.php?t=${encodeURIComponent(name)}`, {
      // Crests essentially never change — cache aggressively.
      next: { revalidate: 60 * 60 * 24 * 30 },
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;

    const data = await res.json().catch(() => null);
    const teams: RawTeam[] = Array.isArray((data as { teams?: unknown })?.teams)
      ? ((data as { teams: RawTeam[] }).teams)
      : [];

    // A club name can collide with a team in another sport (basketball, etc.) — prefer soccer.
    const soccer = teams.find((t) => (t.strSport ?? "").toLowerCase() === "soccer" && t.strBadge);
    return soccer?.strBadge ?? teams.find((t) => t.strBadge)?.strBadge ?? null;
  } catch (err) {
    console.error(`Club logo lookup failed for "${name}"`, err);
    return null;
  }
}

export interface ClubLogoResult {
  name: string;
  logoUrl: string | null;
}

// Resolves every curated top-team's crest in parallel. Failures are per-club and never throw —
// a missing logo just means that club's Avatar falls back to its initials, same as any other team.
export async function getClubLogos(): Promise<ClubLogoResult[]> {
  const names = getAllTopTeamNames();
  return Promise.all(
    names.map(async (name) => ({ name, logoUrl: await searchTeamBadge(name) }))
  );
}

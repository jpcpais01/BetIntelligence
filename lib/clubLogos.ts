// TheSportsDB's shared free test key. Documented for exactly this kind of non-commercial,
// low-volume lookup (searchteams.php by name, returning strBadge as the crest URL).
const SPORTS_DB_BASE = "https://www.thesportsdb.com/api/v1/json/123";

// Every distinct team across the 9 leagues on a busy matchday can run into the hundreds —
// caps how many searchteams.php requests are ever in flight at once so a large batch doesn't
// trip TheSportsDB's free-tier rate limiting the way an uncapped Promise.all would.
const MAX_CONCURRENT = 8;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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

// A hard cap so a malformed or abusive request body can't fan out into an unbounded number
// of outbound lookups — comfortably above the number of distinct teams that could realistically
// appear across every currently-listed game plus a user's saved picks in one batch.
export const MAX_LOGO_NAMES_PER_REQUEST = 300;

// Resolves every requested club's crest, deduped, with bounded concurrency. Failures are
// per-club and never throw — a missing logo just means that club's Avatar falls back to its
// initials, same as any other team we don't have a badge for.
export async function getClubLogos(names: string[]): Promise<ClubLogoResult[]> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(
    0,
    MAX_LOGO_NAMES_PER_REQUEST
  );
  return mapWithConcurrency(unique, MAX_CONCURRENT, async (name) => ({
    name,
    logoUrl: await searchTeamBadge(name),
  }));
}

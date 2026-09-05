import { findBestNameMatch } from "./teamNameMatching";
import { getKnownAliases } from "./topTeams";

// TheSportsDB. `SPORTS_DB_API_KEY` is a free personal key (registration, no payment) — set it to
// move off the shared demo key below, which TheSportsDB's own docs/forum describe as restricted
// for searchteams.php (reports of it returning only Arsenal, or otherwise unreliable, for most
// queries under the shared "123" key). Every fix in this file helps regardless of which key is in
// use, but a real personal key is the actual fix if logos are still wrong/missing after this.
const SPORTS_DB_BASE = `https://www.thesportsdb.com/api/v1/json/${process.env.SPORTS_DB_API_KEY ?? "123"}`;

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
  strAlternate?: string;
  strBadge?: string;
  strSport?: string;
}

function alternateNames(team: RawTeam): string[] {
  if (!team.strAlternate) return [];
  return team.strAlternate
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// The pool worth considering from one search response — prefer soccer-tagged results (a club
// name can collide with a team in another sport), falling back to anything with a badge at all
// only if nothing was tagged soccer.
function candidatePool(teams: RawTeam[]): RawTeam[] {
  const soccer = teams.filter((t) => (t.strSport ?? "").toLowerCase() === "soccer" && t.strBadge);
  return soccer.length > 0 ? soccer : teams.filter((t) => t.strBadge);
}

// Picks the one result that's actually THIS club, never just "whatever came back first" — a
// search can legitimately return several same-named or same-sport-tagged teams (an English lower-
// league side sharing a name with the club we actually meant, a same-named club in a different
// country), and grabbing index 0 is exactly how a wrong crest gets shown instead of no crest at
// all. Verifying against strTeam AND strAlternate (checked the same tiered way every other
// provider's name is matched, lib/teamNameMatching.ts) also means an unrelated/mismatched result
// — including a demo-key quirk that always hands back the same one team regardless of query —
// gets rejected rather than displayed as someone else's badge.
function pickBestTeam(pool: RawTeam[], queryName: string): RawTeam | null {
  return findBestNameMatch(pool, (t) => [t.strTeam, ...alternateNames(t)], queryName);
}

async function searchOnce(query: string): Promise<RawTeam[]> {
  const res = await fetch(`${SPORTS_DB_BASE}/searchteams.php?t=${encodeURIComponent(query)}`, {
    // Crests essentially never change — cache aggressively.
    next: { revalidate: 60 * 60 * 24 * 30 },
    headers: { accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return Array.isArray((data as { teams?: unknown })?.teams) ? (data as { teams: RawTeam[] }).teams : [];
}

interface QueryAttempt {
  query: string;
  // A curated alias ("PSG" for Paris Saint-Germain) is an identity this app already trusts, not a
  // guess — and TheSportsDB's own name for a club often shares no word or substring with it at all
  // ("Paris SG" vs "PSG" passes none of teamNameMatching's tiers), so a single confident result for
  // a trusted query is accepted outright rather than re-checked against a name it was never going
  // to resemble. A generic variant (de-accented, hyphen-swapped) is still just a guess at how this
  // SAME name might be spelled, so it still goes through full name verification.
  trusted: boolean;
}

// Retry queries tried in order when the exact Polymarket-given name doesn't resolve a confident
// match on its own — TheSportsDB documents matching "by main or alternate name," and plenty of
// clubs are registered there under a shorter or differently-spelled form the literal name alone
// won't hit (Paris Saint-Germain's own TheSportsDB page is titled "Paris SG", for instance).
// Cheapest/most-likely variants first so a name that resolves immediately never pays for the rest.
function queryVariants(name: string): QueryAttempt[] {
  const attempts: QueryAttempt[] = [{ query: name, trusted: false }];
  const seen = new Set([name]);
  const addGeneric = (query: string) => {
    if (seen.has(query)) return;
    seen.add(query);
    attempts.push({ query, trusted: false });
  };

  const deaccented = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  addGeneric(deaccented);
  addGeneric(deaccented.replace(/-/g, " "));

  // Known alternate spellings for this app's curated top clubs — the most reliable retry of all,
  // since it's a name this app already trusts rather than a guessed transformation.
  for (const alias of getKnownAliases(name)) {
    if (seen.has(alias)) continue;
    seen.add(alias);
    attempts.push({ query: alias, trusted: true });
  }
  return attempts;
}

async function searchTeamBadge(name: string): Promise<string | null> {
  try {
    for (const { query, trusted } of queryVariants(name)) {
      const pool = candidatePool(await searchOnce(query));
      if (pool.length === 0) continue;

      // A trusted query with exactly one confident soccer candidate is accepted without a name
      // check — see QueryAttempt's comment. Ambiguous (multiple candidates) still falls through
      // to verification, same as any generic variant.
      if (trusted && pool.length === 1) return pool[0].strBadge ?? null;

      const best = pickBestTeam(pool, query);
      if (best?.strBadge) return best.strBadge;
    }
    return null;
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

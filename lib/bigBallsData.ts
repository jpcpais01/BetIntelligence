import type { InjuredPlayer, LeagueId } from "./types";
import { teamNamesMatch } from "./teamNameMatching";

// Player injury/availability data from Big Balls Sports Data (api.bigballsdata.com) — the one
// piece football-data.org's own free tier can't provide at any pricing tier (it has no injuries
// endpoint at all). This is an ENRICHMENT layer, not a core data source: unlike football-data.org
// (where a missing team/fixture fails the whole analysis loudly, since that data is essential and
// was always guaranteed), a league Big Balls Sports Data doesn't cover, a misconfigured key, or a
// request that errors here just means the digest says injury data isn't available for this match —
// it never fails the analysis that already worked fine without this source.
//
// This provider's own domain is blocked by this project's dev sandbox network policy, so its exact
// response shape was first guessed from documentation excerpts, then corrected against a real
// response fetched through /api/debug/injuries once deployed. Confirmed real shape for
// GET /v1/injuries?sport=soccer&league=<key>:
//   { data: { injuries: { value: [{ id, full_name, display_name, current_team_id }], source,
//     via, confidence, fetchedAt, ttlSeconds } }, meta: {...}, error: null }
// Two things the original guess got wrong: the array sits one level deeper than expected, at
// data.injuries.value rather than data.injuries directly (silently discarded by the Array.isArray
// guard, not crashed — but discarded all the same); and each record carries no team NAME at all,
// only an opaque current_team_id, so a separate teams lookup is needed to resolve that to
// something matchable against Polymarket's own team names. There's also no reason/status/expected-
// return field on a record — this endpoint appears to be a bare "unavailable" flag, not a detailed
// injury report.
const BIG_BALLS_BASE = "https://api.bigballsdata.com/v1";
const REQUEST_TIMEOUT_MS = 15_000;

// Big Balls Sports Data's own league keys for the soccer competitions it covers — confirmed
// directly against their documentation, not guessed. It does not cover Primeira Liga, Eredivisie,
// or Belgian Pro League; those leagues just get an honest "not available" line, the same way
// football-data.org itself already omits Belgian Pro League rather than guessing at a code.
const BIG_BALLS_LEAGUE: Partial<Record<LeagueId, string>> = {
  "premier-league": "epl",
  "la-liga": "laliga",
  "serie-a": "seriea",
  bundesliga: "bundesliga",
  "ligue-1": "ligue1",
  "champions-league": "ucl",
};

// This API wraps array payloads in a { value: [...], source, via, confidence, fetchedAt,
// ttlSeconds } envelope (confirmed on /injuries) — unwrapped defensively here since a plain array
// is also accepted, in case a different endpoint or a future API version doesn't wrap it.
function unwrapValueArray<T>(field: unknown): T[] {
  if (Array.isArray(field)) return field as T[];
  if (field && typeof field === "object" && Array.isArray((field as { value?: unknown }).value)) {
    return (field as { value: T[] }).value;
  }
  return [];
}

interface BigBallsInjuryRecord {
  id?: string;
  full_name?: string;
  display_name?: string;
  current_team_id?: string;
  // Alternate/legacy field names kept as a fallback in case a different league or a future API
  // version reports a richer shape than the bare id/name/team-id one actually observed.
  player?: { id?: string | number; name?: string };
  team?: { id?: string | number; name?: string };
  teamName?: string;
  club?: string;
  reason?: string;
  status?: string;
  expectedReturn?: string;
  expected_return?: string;
}

interface BigBallsInjuriesResponse {
  data?: { injuries?: unknown };
  injuries?: unknown;
  error?: unknown;
}

function extractInjuries(response: BigBallsInjuriesResponse): BigBallsInjuryRecord[] {
  return unwrapValueArray<BigBallsInjuryRecord>(response.data?.injuries ?? response.injuries);
}

function recordPlayerName(record: BigBallsInjuryRecord): string {
  return record.player?.name ?? record.display_name ?? record.full_name ?? "Unknown player";
}

// No reason/status/expected-return field has actually been observed on a record — this endpoint
// looks like a bare "currently unavailable" flag rather than a detailed injury report, so the
// honest fallback says exactly that instead of implying a status was checked and found empty.
function recordDetail(record: BigBallsInjuryRecord): string {
  const reason = record.reason ?? record.status;
  const expected = record.expectedReturn ?? record.expected_return;
  const parts = [reason, expected ? `expected back ${expected}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "reported unavailable";
}

interface BigBallsTeamRecord {
  id?: string;
  name?: string;
  full_name?: string;
  display_name?: string;
}

interface BigBallsTeamsResponse {
  data?: { teams?: unknown };
  teams?: unknown;
}

// Team rosters/ids essentially never change mid-season — cached far longer than the injuries list
// itself, which needs to stay fresher.
const TEAMS_CACHE_TTL_MS = 60 * 60_000;
const teamsCache = new Map<string, { at: number; namesById: Map<string, string> }>();

async function fetchLeagueTeamNames(leagueKey: string): Promise<Map<string, string>> {
  const cached = teamsCache.get(leagueKey);
  if (cached && Date.now() - cached.at < TEAMS_CACHE_TTL_MS) return cached.namesById;

  const apiKey = process.env.BIG_BALLS_API_KEY;
  if (!apiKey) return new Map();

  const url = `${BIG_BALLS_BASE}/teams?sport=soccer&league=${leagueKey}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Big Balls Sports Data teams request failed (${res.status} ${url}): ${body.slice(0, 300)}`);
      return new Map();
    }
    const json = (await res.json()) as BigBallsTeamsResponse;
    const records = unwrapValueArray<BigBallsTeamRecord>(json.data?.teams ?? json.teams);
    const namesById = new Map<string, string>();
    for (const t of records) {
      const name = t.name ?? t.full_name ?? t.display_name;
      if (t.id && name) namesById.set(t.id, name);
    }
    if (namesById.size === 0) {
      console.error(`Big Balls Sports Data returned no usable teams for ${url}. Raw response: ${JSON.stringify(json).slice(0, 500)}`);
    }
    teamsCache.set(leagueKey, { at: Date.now(), namesById });
    return namesById;
  } catch (err) {
    console.error(`Big Balls Sports Data teams request threw (${url}): ${err instanceof Error ? err.message : String(err)}`);
    return new Map();
  }
}

function recordTeamName(record: BigBallsInjuryRecord, teamNamesById: Map<string, string>): string | null {
  const direct = record.team?.name ?? record.teamName ?? record.club;
  if (direct) return direct;
  if (record.current_team_id) return teamNamesById.get(record.current_team_id) ?? null;
  return null;
}

// A whole league's injury list barely changes minute to minute, and the free tier's budget here
// (100 req/min, 1,000-2,000 req/day) is far more generous than football-data.org's — this cache
// exists to be polite about repeat calls within the same few minutes, not to protect a scarce
// budget the way football-data.org's rate limiter does.
const INJURIES_CACHE_TTL_MS = 10 * 60_000;
const injuriesCache = new Map<string, { at: number; injuries: BigBallsInjuryRecord[] }>();

async function fetchLeagueInjuries(leagueKey: string): Promise<BigBallsInjuryRecord[]> {
  const cached = injuriesCache.get(leagueKey);
  if (cached && Date.now() - cached.at < INJURIES_CACHE_TTL_MS) return cached.injuries;

  const apiKey = process.env.BIG_BALLS_API_KEY;
  if (!apiKey) {
    console.error("Big Balls Sports Data: BIG_BALLS_API_KEY is not configured, skipping injuries.");
    return [];
  }

  const url = `${BIG_BALLS_BASE}/injuries?sport=soccer&league=${leagueKey}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Logged (not thrown) because this source is soft-fail-only by design — but silent
      // failures are exactly why a real shape/auth mismatch went undiagnosed before this. See
      // /api/debug/injuries for a way to inspect this directly instead of guessing from logs.
      console.error(`Big Balls Sports Data request failed (${res.status} ${url}): ${body.slice(0, 300)}`);
      return [];
    }
    const json = (await res.json()) as BigBallsInjuriesResponse;
    const injuries = extractInjuries(json);
    if (injuries.length === 0) {
      console.error(`Big Balls Sports Data returned no usable injuries array for ${url}. Raw response: ${JSON.stringify(json).slice(0, 500)}`);
    }
    injuriesCache.set(leagueKey, { at: Date.now(), injuries });
    return injuries;
  } catch (err) {
    console.error(`Big Balls Sports Data request threw (${url}): ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// Test-only: clears the module-level caches so selftest cases don't see stale data from an
// earlier case sharing the same league key.
export function __resetInjuriesCacheForTests(): void {
  injuriesCache.clear();
  teamsCache.clear();
}

// Not used by buildInjuryDigest — exists purely for /api/debug/injuries, since this provider's
// exact response shape wasn't fully verifiable ahead of time (its domain is blocked from this
// project's dev sandbox network policy). Returns the RAW responses for both the injuries and
// teams endpoints, untouched by any of the parsing assumptions above, so a real shape or auth
// mismatch can be seen directly instead of guessed at again.
export async function debugFetchLeagueInjuries(league: LeagueId): Promise<{
  leagueKey: string | null;
  hasApiKey: boolean;
  injuries: { url: string; status: number | null; ok: boolean | null; body: unknown; error: string | null } | null;
  teams: { url: string; status: number | null; ok: boolean | null; body: unknown; error: string | null } | null;
  error: string | null;
}> {
  const leagueKey = BIG_BALLS_LEAGUE[league] ?? null;
  const apiKey = process.env.BIG_BALLS_API_KEY;

  if (!leagueKey) {
    return { leagueKey: null, hasApiKey: !!apiKey, injuries: null, teams: null, error: "This league isn't covered by Big Balls Sports Data." };
  }
  if (!apiKey) {
    return { leagueKey, hasApiKey: false, injuries: null, teams: null, error: "BIG_BALLS_API_KEY is not configured." };
  }

  const rawFetch = async (path: string) => {
    const url = `${BIG_BALLS_BASE}${path}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON — keep the raw text so it's still visible rather than swallowed.
      }
      return { url, status: res.status, ok: res.ok, body, error: null };
    } catch (err) {
      return { url, status: null, ok: null, body: null, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const [injuries, teams] = await Promise.all([
    rawFetch(`/injuries?sport=soccer&league=${leagueKey}`),
    rawFetch(`/teams?sport=soccer&league=${leagueKey}`),
  ]);

  return { leagueKey, hasApiKey: true, injuries, teams, error: null };
}

// Structured per-team out-players list for the analysis UI's injuries infogram — a separate,
// parallel path to buildInjuryDigest's text below rather than a refactor of it, so the
// already-tested text output can't be disturbed by this. Both call the same cached fetchers
// (fetchLeagueInjuries/fetchLeagueTeamNames), so this never costs a second real request — a
// concurrent or immediately-following call for the same league just hits the cache. Returns null
// when there's nothing usable to attribute per-team (uncovered league, no data at all, or
// team-name resolution failing) — never a guess at which side an unattributed player belongs to.
export async function fetchInjurySummary(input: {
  homeTeam: string;
  awayTeam: string;
  league: LeagueId;
}): Promise<{ home: InjuredPlayer[]; away: InjuredPlayer[] } | null> {
  const leagueKey = BIG_BALLS_LEAGUE[input.league];
  if (!leagueKey) return null;

  const [injuries, teamNamesById] = await Promise.all([fetchLeagueInjuries(leagueKey), fetchLeagueTeamNames(leagueKey)]);
  if (injuries.length === 0 || teamNamesById.size === 0) return null;

  const forTeam = (teamName: string): InjuredPlayer[] =>
    injuries
      .filter((r) => {
        const name = recordTeamName(r, teamNamesById);
        return name !== null && teamNamesMatch(name, teamName);
      })
      .map((r) => ({ name: recordPlayerName(r), detail: recordDetail(r) }));

  return { home: forTeam(input.homeTeam), away: forTeam(input.awayTeam) };
}

function formatTeamInjuries(teamName: string, records: BigBallsInjuryRecord[], teamNamesById: Map<string, string>): string {
  const relevant = records.filter((r) => {
    const name = recordTeamName(r, teamNamesById);
    return name !== null && teamNamesMatch(name, teamName);
  });
  if (relevant.length === 0) return "No reported injuries.";
  return relevant.map((r) => `- ${recordPlayerName(r)}: ${recordDetail(r)}`).join("\n");
}

// Always resolves — never throws. A league this provider doesn't cover, a missing/invalid key, or
// any request failure all render as an honest "not available" line rather than failing the whole
// football digest this gets appended to.
export async function buildInjuryDigest(input: {
  homeTeam: string;
  awayTeam: string;
  league: LeagueId;
}): Promise<string> {
  const leagueKey = BIG_BALLS_LEAGUE[input.league];
  if (!leagueKey) {
    return `Injuries / Availability:\nInjury data not available for this league.`;
  }

  const [injuries, teamNamesById] = await Promise.all([fetchLeagueInjuries(leagueKey), fetchLeagueTeamNames(leagueKey)]);
  if (injuries.length === 0) {
    return `Injuries / Availability:\nInjury data not available for this match.`;
  }

  // Team-name resolution failing (an empty map) is distinct from there being no injuries at all —
  // rather than silently showing "no reported injuries" for both teams (which would be actively
  // misleading if players ARE listed but just couldn't be attributed), surface the full unmatched
  // list so the digest still carries real information while that gets diagnosed.
  if (teamNamesById.size === 0) {
    const names = injuries.map((r) => recordPlayerName(r)).filter((n) => n !== "Unknown player");
    return `Injuries / Availability:
Could not map players to specific teams for this league (team-name lookup returned nothing) — full list of players currently reported unavailable league-wide: ${names.length > 0 ? names.join(", ") : "none"}.`;
  }

  return `Injuries / Availability:
${input.homeTeam}:
${formatTeamInjuries(input.homeTeam, injuries, teamNamesById)}

${input.awayTeam}:
${formatTeamInjuries(input.awayTeam, injuries, teamNamesById)}`;
}

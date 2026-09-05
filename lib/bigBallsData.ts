import type { LeagueId } from "./types";
import { teamNamesMatch } from "./teamNameMatching";

// Player injury/availability data from Big Balls Sports Data (api.bigballsdata.com) — the one
// piece football-data.org's own free tier can't provide at any pricing tier (it has no injuries
// endpoint at all). This is an ENRICHMENT layer, not a core data source: unlike football-data.org
// (where a missing team/fixture fails the whole analysis loudly, since that data is essential and
// was always guaranteed), a league Big Balls Sports Data doesn't cover, a misconfigured key, or a
// request that errors here just means the digest says injury data isn't available for this match —
// it never fails the analysis that already worked fine without this source.
//
// This provider's own domain is blocked by this project's dev sandbox network policy the same way
// football-data.org's docs were, so its exact response shape was pieced together from published
// documentation excerpts rather than a live test call. If the injuries section ever looks wrong
// once deployed (empty when it shouldn't be, wrong team, etc.), the actual response body from a
// real call is what would pin down any field-name mismatch — same as how football-data.org's own
// integration was refined from real production errors earlier.
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

interface BigBallsInjuryRecord {
  player?: { id?: string | number; name?: string };
  team?: { id?: string | number; name?: string };
  // Alternate field names the real API might use instead of a nested `team` object — read
  // defensively since the exact schema wasn't directly verifiable (see module comment above).
  teamName?: string;
  club?: string;
  reason?: string;
  status?: string;
  expectedReturn?: string;
  expected_return?: string;
}

interface BigBallsInjuriesResponse {
  data?: { injuries?: BigBallsInjuryRecord[] };
  injuries?: BigBallsInjuryRecord[];
}

// `as BigBallsInjuriesResponse` on the parsed JSON only tells TypeScript what shape to expect —
// it doesn't check anything at runtime. If the real API's shape differs from what was guessed
// (this provider's exact schema was never verified with a live call, see the module comment
// above), `injuries` could come back as something other than an array; Array.isArray here is
// what actually stops that from becoming a hard crash a few lines later at `.filter(...)`.
function extractInjuries(response: BigBallsInjuriesResponse): BigBallsInjuryRecord[] {
  const injuries = response.data?.injuries ?? response.injuries;
  return Array.isArray(injuries) ? injuries : [];
}

function recordTeamName(record: BigBallsInjuryRecord): string | null {
  return record.team?.name ?? record.teamName ?? record.club ?? null;
}

function recordPlayerName(record: BigBallsInjuryRecord): string {
  return record.player?.name ?? "Unknown player";
}

function recordDetail(record: BigBallsInjuryRecord): string {
  const reason = record.reason ?? record.status;
  const expected = record.expectedReturn ?? record.expected_return;
  const parts = [reason, expected ? `expected back ${expected}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "status unspecified";
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

// Test-only: clears the module-level cache so selftest cases don't see stale injuries from an
// earlier case sharing the same league key.
export function __resetInjuriesCacheForTests(): void {
  injuriesCache.clear();
}

// Not used by buildInjuryDigest — exists purely for /api/debug/injuries, since this provider's
// exact response shape was never verified with a live call (its domain is blocked from this
// project's dev sandbox network policy). Returns the RAW response untouched by any of the parsing
// assumptions above, so a real shape/auth mismatch can be seen directly instead of guessed at again.
export async function debugFetchLeagueInjuries(league: LeagueId): Promise<{
  leagueKey: string | null;
  url: string | null;
  hasApiKey: boolean;
  status: number | null;
  ok: boolean | null;
  body: unknown;
  error: string | null;
}> {
  const leagueKey = BIG_BALLS_LEAGUE[league] ?? null;
  const apiKey = process.env.BIG_BALLS_API_KEY;

  if (!leagueKey) {
    return { leagueKey: null, url: null, hasApiKey: !!apiKey, status: null, ok: null, body: null, error: "This league isn't covered by Big Balls Sports Data." };
  }
  if (!apiKey) {
    return { leagueKey, url: null, hasApiKey: false, status: null, ok: null, body: null, error: "BIG_BALLS_API_KEY is not configured." };
  }

  const url = `${BIG_BALLS_BASE}/injuries?sport=soccer&league=${leagueKey}`;
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
    return { leagueKey, url, hasApiKey: true, status: res.status, ok: res.ok, body, error: null };
  } catch (err) {
    return { leagueKey, url, hasApiKey: true, status: null, ok: null, body: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function formatTeamInjuries(teamName: string, records: BigBallsInjuryRecord[]): string {
  const relevant = records.filter((r) => {
    const name = recordTeamName(r);
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

  const injuries = await fetchLeagueInjuries(leagueKey);
  if (injuries.length === 0) {
    return `Injuries / Availability:\nInjury data not available for this match.`;
  }

  return `Injuries / Availability:
${input.homeTeam}:
${formatTeamInjuries(input.homeTeam, injuries)}

${input.awayTeam}:
${formatTeamInjuries(input.awayTeam, injuries)}`;
}

import type { LeagueId } from "./types";

// Structured match data straight from API-Football (api-football.com / v3.football.api-sports.io)
// — replaces the old "AI reads the open web" research step for football entirely, since a search
// engine's summary of injuries/form/lineups turned out to be unreliable often enough to be worse
// than useless. No fallback to web search on a miss: if a team or fixture can't be resolved here,
// the analysis fails with a clear error rather than quietly falling back to a shakier source.
const API_FOOTBALL_URL = "https://v3.football.api-sports.io";
const REQUEST_TIMEOUT_MS = 20_000;

// Stable, well-known API-Football league ids for the 8 leagues this app covers — these are fixed
// identifiers for the competition itself (not the season), sourced from API-Football's own
// /leagues reference data, and don't change from year to year.
const LEAGUE_API_ID: Record<LeagueId, number> = {
  "premier-league": 39,
  "la-liga": 140,
  bundesliga: 78,
  "ligue-1": 61,
  "serie-a": 135,
  "primeira-liga": 94,
  eredivisie: 88,
  "belgian-pro-league": 144,
};

interface ApiFootballTeam {
  id: number;
  name: string;
}

interface ApiFootballFixtureStatus {
  long: string;
  short: string;
  elapsed: number | null;
}

interface ApiFootballFixture {
  fixture: { id: number; date: string; status: ApiFootballFixtureStatus };
  teams: { home: ApiFootballTeam; away: ApiFootballTeam };
  goals: { home: number | null; away: number | null };
}

interface ApiFootballInjury {
  player: { name: string; type: string; reason: string };
  team: { id: number };
}

async function apiFootballFetch<T>(path: string): Promise<T> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    throw new Error("API_FOOTBALL_KEY is not configured. Add it to your environment to enable football analysis.");
  }

  let res: Response;
  try {
    res = await fetch(`${API_FOOTBALL_URL}${path}`, {
      headers: { "x-apisports-key": apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Could not reach API-Football: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API-Football request failed (${res.status} ${path}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json().catch(() => null)) as { response?: T; errors?: unknown } | null;
  const errors = data?.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors && Object.keys(errors).length > 0;
  if (hasErrors) {
    throw new Error(`API-Football error (${path}): ${JSON.stringify(errors).slice(0, 300)}`);
  }

  return (data?.response ?? []) as T;
}

// European domestic seasons run roughly Aug-May; API-Football's `season` param is the year the
// season STARTED, so a January match belongs to the season that started the previous calendar year.
function seasonForDate(iso: string): number {
  const d = new Date(iso);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}

function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findBestTeamMatch(teams: ApiFootballTeam[], name: string): ApiFootballTeam | null {
  const target = normalizeTeamName(name);
  const exact = teams.find((t) => normalizeTeamName(t.name) === target);
  if (exact) return exact;
  // Polymarket sometimes shortens or lengthens a club's display name (e.g. "Man United" vs
  // "Manchester United") — a substring match either direction covers that without getting too
  // loose, since we're only ever matching within the ~20 teams of the one league we already know.
  return (
    teams.find((t) => {
      const n = normalizeTeamName(t.name);
      return n.includes(target) || target.includes(n);
    }) ?? null
  );
}

// Team rosters barely change within a season — cached per (league, season) for the life of the
// warm server instance so analyzing several matches from the same league doesn't repeat this
// call, which matters on a 100-requests/day free tier.
const teamsCache = new Map<string, ApiFootballTeam[]>();

async function fetchLeagueTeams(leagueApiId: number, season: number): Promise<ApiFootballTeam[]> {
  const key = `${leagueApiId}:${season}`;
  const cached = teamsCache.get(key);
  if (cached) return cached;
  const response = await apiFootballFetch<{ team: ApiFootballTeam }[]>(`/teams?league=${leagueApiId}&season=${season}`);
  const teams = response.map((r) => r.team);
  teamsCache.set(key, teams);
  return teams;
}

async function findFixture(
  leagueApiId: number,
  season: number,
  homeId: number,
  awayId: number,
  kickoffIso: string
): Promise<ApiFootballFixture | null> {
  const kickoff = new Date(kickoffIso).getTime();
  const from = new Date(kickoff - 2 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(kickoff + 2 * 86_400_000).toISOString().slice(0, 10);
  const fixtures = await apiFootballFetch<ApiFootballFixture[]>(
    `/fixtures?league=${leagueApiId}&season=${season}&from=${from}&to=${to}&team=${homeId}`
  );
  return (
    fixtures.find(
      (f) =>
        (f.teams.home.id === homeId && f.teams.away.id === awayId) ||
        (f.teams.home.id === awayId && f.teams.away.id === homeId)
    ) ?? null
  );
}

interface FormLine {
  date: string;
  summary: string;
}

async function fetchForm(teamId: number): Promise<FormLine[]> {
  // The 5 most recently PLAYED fixtures relative to right now — since this only ever runs before
  // or around kickoff, that's already exactly "recent form" with no extra date filtering needed.
  const fixtures = await apiFootballFetch<ApiFootballFixture[]>(`/fixtures?team=${teamId}&last=5`);
  return fixtures
    .filter((f) => f.fixture.status.short === "FT" || f.fixture.status.short === "AET" || f.fixture.status.short === "PEN")
    .map((f) => {
      const isHome = f.teams.home.id === teamId;
      const own = isHome ? f.goals.home : f.goals.away;
      const opp = isHome ? f.goals.away : f.goals.home;
      const opponent = isHome ? f.teams.away.name : f.teams.home.name;
      const result = own === null || opp === null ? "?" : own > opp ? "W" : own < opp ? "L" : "D";
      return {
        date: f.fixture.date.slice(0, 10),
        summary: `${result} ${own ?? "?"}-${opp ?? "?"} ${isHome ? "vs" : "at"} ${opponent}`,
      };
    });
}

async function fetchHeadToHead(homeId: number, awayId: number): Promise<FormLine[]> {
  const fixtures = await apiFootballFetch<ApiFootballFixture[]>(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=5`);
  return fixtures
    .filter((f) => f.fixture.status.short === "FT" || f.fixture.status.short === "AET" || f.fixture.status.short === "PEN")
    .map((f) => ({
      date: f.fixture.date.slice(0, 10),
      summary: `${f.teams.home.name} ${f.goals.home ?? "?"}-${f.goals.away ?? "?"} ${f.teams.away.name}`,
    }));
}

function formatInjuries(injuries: ApiFootballInjury[], teamId: number, teamName: string): string {
  const forTeam = injuries.filter((i) => i.team.id === teamId);
  if (forTeam.length === 0) return `${teamName}: no reported injuries or suspensions for this fixture.`;
  return forTeam.map((i) => `- ${i.player.name} (${i.player.type}: ${i.player.reason})`).join("\n");
}

export interface ApiFootballDigest {
  text: string;
}

// A short in-memory cache keyed by the exact match, mainly so the "research runs" stepper (which
// fires several parallel requests for the *same* match) doesn't burn several of a 100/day quota
// on data that would come back identical every time. Kept short (not per-league like the roster
// cache above) since a live match's score can change within minutes.
const DIGEST_CACHE_TTL_MS = 2 * 60_000;
const digestCache = new Map<string, { at: number; digest: ApiFootballDigest }>();

export async function buildApiFootballDigest(input: {
  homeTeam: string;
  awayTeam: string;
  league: LeagueId;
  startTime: string;
}): Promise<ApiFootballDigest> {
  const cacheKey = `${input.league}|${input.homeTeam}|${input.awayTeam}|${input.startTime}`;
  const cached = digestCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DIGEST_CACHE_TTL_MS) return cached.digest;

  const leagueApiId = LEAGUE_API_ID[input.league];
  const season = seasonForDate(input.startTime);

  const teams = await fetchLeagueTeams(leagueApiId, season);
  const home = findBestTeamMatch(teams, input.homeTeam);
  const away = findBestTeamMatch(teams, input.awayTeam);
  if (!home || !away) {
    throw new Error(
      `Could not find "${!home ? input.homeTeam : input.awayTeam}" in API-Football's ${season} roster for this league.`
    );
  }

  const fixture = await findFixture(leagueApiId, season, home.id, away.id, input.startTime);
  if (!fixture) {
    throw new Error(`Could not find a fixture between ${input.homeTeam} and ${input.awayTeam} on API-Football.`);
  }

  const [homeForm, awayForm, injuries, h2h] = await Promise.all([
    fetchForm(home.id),
    fetchForm(away.id),
    apiFootballFetch<ApiFootballInjury[]>(`/injuries?fixture=${fixture.fixture.id}`),
    fetchHeadToHead(home.id, away.id),
  ]);

  const status = fixture.fixture.status;
  const notYetStarted = status.short === "TBD" || status.short === "NS" || status.short === "PST" || status.short === "CANC";
  const statusLine = notYetStarted
    ? `Match has not started yet — kickoff scheduled for ${new Date(fixture.fixture.date).toUTCString()}.`
    : `Match status: ${status.long}${status.elapsed !== null ? ` (${status.elapsed}')` : ""} — current score ` +
      `${input.homeTeam} ${fixture.goals.home ?? "?"}-${fixture.goals.away ?? "?"} ${input.awayTeam}, as of ` +
      `${new Date(fixture.fixture.date).toUTCString()} kickoff.`;

  const text = `Match Status:
${statusLine}

${input.homeTeam} Form (last 5 completed matches):
${homeForm.length > 0 ? homeForm.map((f) => `- ${f.date}: ${f.summary}`).join("\n") : "No recent completed fixtures found."}

${input.awayTeam} Form (last 5 completed matches):
${awayForm.length > 0 ? awayForm.map((f) => `- ${f.date}: ${f.summary}`).join("\n") : "No recent completed fixtures found."}

Injuries & Suspensions:
${formatInjuries(injuries, home.id, input.homeTeam)}
${formatInjuries(injuries, away.id, input.awayTeam)}

Head-to-Head History (last 5 meetings):
${h2h.length > 0 ? h2h.map((f) => `- ${f.date}: ${f.summary}`).join("\n") : "No previous meetings found."}`;

  const digest: ApiFootballDigest = { text };
  digestCache.set(cacheKey, { at: Date.now(), digest });
  return digest;
}

import type { LeagueId } from "./types";

// Structured match data from football-data.org (api.football-data.org/v4) — replaces the old "AI
// reads the open web" research step for football entirely, since a search engine's summary of
// form/injuries/lineups turned out to be unreliable often enough to be worse than useless.
//
// This app previously tried API-Football (api-sports.io) for this instead. Its free plan looked
// identical on paper (form, injuries, fixture status, all endpoints "included"), but in practice
// locks every endpoint to old completed seasons ("Free plans do not have access to this season,
// try from 2022 to 2024") — useless for analyzing a current or upcoming match, which is the app's
// entire use case. football-data.org's free tier has no such season lock and covers 7 of the 8
// leagues below at no cost; it also has no injuries endpoint at any tier, so that section is
// simply not part of the digest — reporting nothing is better than reporting something wrong.
//
// No fallback to web search on a miss: if a team or fixture can't be resolved here, the analysis
// fails with a clear error rather than quietly falling back to a shakier source.
const FOOTBALL_DATA_URL = "https://api.football-data.org/v4";
const REQUEST_TIMEOUT_MS = 20_000;

// football-data.org's own competition codes. Belgian Pro League has no free-tier code at all —
// analyzing one of its matches fails with a clear "not available on the free plan" error rather
// than silently guessing at a paid-only code.
const COMPETITION_CODE: Partial<Record<LeagueId, string>> = {
  "premier-league": "PL",
  "la-liga": "PD",
  bundesliga: "BL1",
  "ligue-1": "FL1",
  "serie-a": "SA",
  "primeira-liga": "PPL",
  eredivisie: "DED",
};

interface FootballDataTeam {
  id: number;
  name: string;
  shortName?: string;
}

interface FootballDataScore {
  fullTime: { home: number | null; away: number | null };
}

interface FootballDataMatch {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: FootballDataTeam;
  awayTeam: FootballDataTeam;
  score: FootballDataScore;
}

const NOT_YET_STARTED = new Set(["SCHEDULED", "TIMED", "POSTPONED", "CANCELED", "SUSPENDED"]);

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Scheduled",
  TIMED: "Scheduled",
  LIVE: "Live",
  IN_PLAY: "In Play",
  PAUSED: "Halftime/Paused",
  FINISHED: "Finished",
  POSTPONED: "Postponed",
  SUSPENDED: "Suspended",
  CANCELED: "Cancelled",
};

async function footballDataFetch<T>(path: string): Promise<T> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    throw new Error("FOOTBALL_DATA_API_KEY is not configured. Add it to your environment to enable football analysis.");
  }

  const attempt = async (): Promise<Response> =>
    fetch(`${FOOTBALL_DATA_URL}${path}`, {
      headers: { "X-Auth-Token": apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let res: Response;
  try {
    res = await attempt();
    // The free tier's 10-requests/minute cap is easy to brush against when several "research
    // runs" fire in parallel for the same match — one short retry covers that burst without
    // treating a real, sustained failure as retryable forever.
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      res = await attempt();
    }
  } catch (err) {
    throw new Error(`Could not reach football-data.org: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`football-data.org request failed (${res.status} ${path}): ${body.slice(0, 300)}`);
  }

  return (await res.json()) as T;
}

function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findBestTeamMatch(teams: FootballDataTeam[], name: string): FootballDataTeam | null {
  const target = normalizeTeamName(name);
  const exact = teams.find((t) => normalizeTeamName(t.name) === target || (t.shortName && normalizeTeamName(t.shortName) === target));
  if (exact) return exact;
  // Polymarket sometimes shortens or lengthens a club's display name (e.g. "Newcastle" vs
  // "Newcastle United") — a substring match either direction covers that without getting too
  // loose, since we're only ever matching within the ~20 teams of the one league we already know.
  return (
    teams.find((t) => {
      const n = normalizeTeamName(t.name);
      return n.includes(target) || target.includes(n);
    }) ?? null
  );
}

// A competition's roster barely changes within a season — cached for the life of the warm server
// instance so analyzing several matches from the same league doesn't repeat this call, which
// matters on a 10-requests/minute free tier.
const teamsCache = new Map<string, FootballDataTeam[]>();

async function fetchCompetitionTeams(code: string): Promise<FootballDataTeam[]> {
  const cached = teamsCache.get(code);
  if (cached) return cached;
  const response = await footballDataFetch<{ teams: FootballDataTeam[] }>(`/competitions/${code}/teams`);
  teamsCache.set(code, response.teams);
  return response.teams;
}

async function findFixture(code: string, homeId: number, awayId: number, kickoffIso: string): Promise<FootballDataMatch | null> {
  const kickoff = new Date(kickoffIso).getTime();
  const from = new Date(kickoff - 2 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(kickoff + 2 * 86_400_000).toISOString().slice(0, 10);
  const response = await footballDataFetch<{ matches: FootballDataMatch[] }>(
    `/matches?competitions=${code}&dateFrom=${from}&dateTo=${to}`
  );
  return (
    response.matches.find(
      (m) =>
        (m.homeTeam.id === homeId && m.awayTeam.id === awayId) || (m.homeTeam.id === awayId && m.awayTeam.id === homeId)
    ) ?? null
  );
}

interface FormLine {
  date: string;
  summary: string;
}

async function fetchForm(teamId: number): Promise<FormLine[]> {
  const response = await footballDataFetch<{ matches: FootballDataMatch[] }>(`/teams/${teamId}/matches?status=FINISHED&limit=5`);
  return response.matches.map((m) => {
    const isHome = m.homeTeam.id === teamId;
    const own = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const opp = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    const opponent = isHome ? m.awayTeam.name : m.homeTeam.name;
    const result = own === null || opp === null ? "?" : own > opp ? "W" : own < opp ? "L" : "D";
    return { date: m.utcDate.slice(0, 10), summary: `${result} ${own ?? "?"}-${opp ?? "?"} ${isHome ? "vs" : "at"} ${opponent}` };
  });
}

interface Head2HeadResponse {
  matches: FootballDataMatch[];
}

async function fetchHeadToHead(fixtureId: number): Promise<FormLine[]> {
  const response = await footballDataFetch<Head2HeadResponse>(`/matches/${fixtureId}/head2head?limit=5`);
  return response.matches
    .filter((m) => m.status === "FINISHED")
    .map((m) => ({
      date: m.utcDate.slice(0, 10),
      summary: `${m.homeTeam.name} ${m.score.fullTime.home ?? "?"}-${m.score.fullTime.away ?? "?"} ${m.awayTeam.name}`,
    }));
}

export interface FootballDigest {
  text: string;
}

// A short in-memory cache keyed by the exact match, mainly so the "research runs" stepper (which
// fires several parallel requests for the *same* match) doesn't burn through the 10-requests/
// minute free-tier limit on data that would come back identical every time.
const DIGEST_CACHE_TTL_MS = 2 * 60_000;
const digestCache = new Map<string, { at: number; digest: FootballDigest }>();

export async function buildFootballDigest(input: {
  homeTeam: string;
  awayTeam: string;
  league: LeagueId;
  startTime: string;
}): Promise<FootballDigest> {
  const cacheKey = `${input.league}|${input.homeTeam}|${input.awayTeam}|${input.startTime}`;
  const cached = digestCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DIGEST_CACHE_TTL_MS) return cached.digest;

  const code = COMPETITION_CODE[input.league];
  if (!code) {
    throw new Error(
      "This league isn't available on football-data.org's free plan (only Premier League, La Liga, Bundesliga, Serie A, " +
        "Ligue 1, Primeira Liga, and Eredivisie are)."
    );
  }

  const teams = await fetchCompetitionTeams(code);
  const home = findBestTeamMatch(teams, input.homeTeam);
  const away = findBestTeamMatch(teams, input.awayTeam);
  if (!home || !away) {
    throw new Error(`Could not find "${!home ? input.homeTeam : input.awayTeam}" in football-data.org's roster for this league.`);
  }

  const fixture = await findFixture(code, home.id, away.id, input.startTime);
  if (!fixture) {
    throw new Error(`Could not find a fixture between ${input.homeTeam} and ${input.awayTeam} on football-data.org.`);
  }

  const [homeForm, awayForm, h2h] = await Promise.all([
    fetchForm(home.id),
    fetchForm(away.id),
    fetchHeadToHead(fixture.id),
  ]);

  const notYetStarted = NOT_YET_STARTED.has(fixture.status);
  const statusLabel = STATUS_LABEL[fixture.status] ?? fixture.status;
  const statusLine = notYetStarted
    ? `Match has not started yet — kickoff scheduled for ${new Date(fixture.utcDate).toUTCString()} (status: ${statusLabel}).`
    : `Match status: ${statusLabel} — current score ${input.homeTeam} ${fixture.score.fullTime.home ?? "?"}-` +
      `${fixture.score.fullTime.away ?? "?"} ${input.awayTeam}, kickoff was ${new Date(fixture.utcDate).toUTCString()}.`;

  const text = `Match Status:
${statusLine}

${input.homeTeam} Form (last 5 completed matches):
${homeForm.length > 0 ? homeForm.map((f) => `- ${f.date}: ${f.summary}`).join("\n") : "No recent completed fixtures found."}

${input.awayTeam} Form (last 5 completed matches):
${awayForm.length > 0 ? awayForm.map((f) => `- ${f.date}: ${f.summary}`).join("\n") : "No recent completed fixtures found."}

Head-to-Head History (last 5 meetings):
${h2h.length > 0 ? h2h.map((f) => `- ${f.date}: ${f.summary}`).join("\n") : "No previous meetings found."}`;

  const digest: FootballDigest = { text };
  digestCache.set(cacheKey, { at: Date.now(), digest });
  return digest;
}

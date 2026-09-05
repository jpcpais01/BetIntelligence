import type { LeagueId, TeamStanding } from "./types";
import { findBestNameMatch } from "./teamNameMatching";

// Structured match data from football-data.org (api.football-data.org/v4) — replaces the old "AI
// reads the open web" research step for football entirely, since a search engine's summary of
// form/lineups turned out to be unreliable often enough to be worse than useless.
//
// This app previously tried API-Football (api-sports.io) for this instead. Its free plan looked
// identical on paper (form, injuries, fixture status, all endpoints "included"), but in practice
// locks every endpoint to old completed seasons ("Free plans do not have access to this season,
// try from 2022 to 2024") — useless for analyzing a current or upcoming match, which is the app's
// entire use case. football-data.org's free tier has no such season lock and covers 7 of the 8
// domestic leagues below plus the Champions League at no cost; it has no injuries endpoint at any
// tier, though, which is why injury/availability data comes from a second provider instead
// (lib/bigBallsData.ts) rather than from here.
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
  "champions-league": "CL",
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

// The free tier allows 10 requests/minute — easy to exceed since a single match's digest alone
// takes 4-5 calls, and several matches analyzed within the same minute (a batch analysis, or a
// couple of one-off Analyze taps in quick succession) share that same budget. Rather than firing
// every call immediately and hoping, this tracks a rolling 60s window of request timestamps
// in-process and makes a call WAIT for a free slot before it's ever sent, so the app self-throttles
// down to the real limit instead of ever hitting a 429 under normal single-instance use. This is
// necessarily best-effort — separate concurrent serverless instances don't share this in-memory
// state — so a 429 can still happen; footballDataFetch below still recovers from one if it does.
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const requestTimestamps: number[] = [];

async function waitForRateLimitSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (requestTimestamps.length > 0 && now - requestTimestamps[0] >= RATE_LIMIT_WINDOW_MS) {
      requestTimestamps.shift();
    }
    if (requestTimestamps.length < RATE_LIMIT_MAX_REQUESTS) {
      requestTimestamps.push(now);
      return;
    }
    // Nothing awaits between the length check above and this wait, so two concurrent callers
    // can't both slip through the same slot — the next iteration re-checks after sleeping.
    const waitMs = RATE_LIMIT_WINDOW_MS - (now - requestTimestamps[0]) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

// Test-only: the rate limiter above is shared module state, so a selftest that fires many mocked
// "requests" in quick succession would otherwise trip real multi-second waits meant for the real
// API. Exported so scripts/football-data-selftest.ts can clear it between cases.
export function __resetRateLimiterForTests(): void {
  requestTimestamps.length = 0;
}

// football-data.org's 429 body names exactly how long to wait (e.g. "Wait 57 seconds.") — reading
// that instead of guessing means a single retry actually lands instead of hitting the same wall
// again a moment later. Exported so the selftest can check the parsing directly rather than
// waiting out real retry delays.
export function parseRetryAfterSeconds(body: string): number {
  const match = body.match(/wait (\d+) seconds?/i);
  const seconds = match ? Number(match[1]) : 60;
  return Math.min(Math.max(seconds, 1), 65);
}

async function footballDataFetch<T>(path: string): Promise<T> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    throw new Error("FOOTBALL_DATA_API_KEY is not configured. Add it to your environment to enable football analysis.");
  }

  const attempt = async (): Promise<Response> => {
    await waitForRateLimitSlot();
    return fetch(`${FOOTBALL_DATA_URL}${path}`, {
      headers: { "X-Auth-Token": apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  };

  let res: Response;
  try {
    res = await attempt();
    if (res.status === 429) {
      const body = await res.text().catch(() => "");
      await new Promise((resolve) => setTimeout(resolve, parseRetryAfterSeconds(body) * 1000));
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

function findBestTeamMatch(teams: FootballDataTeam[], name: string): FootballDataTeam | null {
  return findBestNameMatch(teams, (t) => [t.name, t.shortName], name);
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

type FormResult = "W" | "L" | "D" | "?";

interface FormLine {
  date: string;
  summary: string;
  result: FormResult;
}

async function fetchForm(teamId: number): Promise<FormLine[]> {
  const response = await footballDataFetch<{ matches: FootballDataMatch[] }>(`/teams/${teamId}/matches?status=FINISHED&limit=5`);
  return response.matches.map((m) => {
    const isHome = m.homeTeam.id === teamId;
    const own = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const opp = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    const opponent = isHome ? m.awayTeam.name : m.homeTeam.name;
    const result: FormResult = own === null || opp === null ? "?" : own > opp ? "W" : own < opp ? "L" : "D";
    return { date: m.utcDate.slice(0, 10), summary: `${result} ${own ?? "?"}-${opp ?? "?"} ${isHome ? "vs" : "at"} ${opponent}`, result };
  });
}

// The compact "form strip" for the standings infogram, derived from the same matches fetchForm
// already fetched for the text digest rather than a second endpoint — sorted oldest-first (a copy;
// the text digest above keeps whatever order the API itself returned, unchanged) so the strip
// reads left-to-right ending with the most recent match, capped at 5 even if more came back.
function formLetters(form: FormLine[]): FormResult[] {
  return [...form].sort((a, b) => a.date.localeCompare(b.date)).map((f) => f.result).slice(-5);
}

interface Head2HeadResponse {
  matches: FootballDataMatch[];
}

interface H2HLine {
  date: string;
  summary: string;
}

async function fetchHeadToHead(fixtureId: number): Promise<H2HLine[]> {
  const response = await footballDataFetch<Head2HeadResponse>(`/matches/${fixtureId}/head2head?limit=5`);
  return response.matches
    .filter((m) => m.status === "FINISHED")
    .map((m) => ({
      date: m.utcDate.slice(0, 10),
      summary: `${m.homeTeam.name} ${m.score.fullTime.home ?? "?"}-${m.score.fullTime.away ?? "?"} ${m.awayTeam.name}`,
    }));
}

interface FootballDataStandingRow {
  position: number;
  team: FootballDataTeam;
  playedGames: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

interface FootballDataStandingsResponse {
  standings: { type: string; table: FootballDataStandingRow[] }[];
}

// A competition's table barely moves within a day — cached far longer than a live score, short
// enough that it's never more than a day stale for the standings infogram.
const STANDINGS_CACHE_TTL_MS = 6 * 60 * 60_000;
const standingsCache = new Map<string, { at: number; rows: FootballDataStandingRow[] }>();

async function fetchCompetitionStandingsRows(code: string): Promise<FootballDataStandingRow[]> {
  const cached = standingsCache.get(code);
  if (cached && Date.now() - cached.at < STANDINGS_CACHE_TTL_MS) return cached.rows;

  const response = await footballDataFetch<FootballDataStandingsResponse>(`/competitions/${code}/standings`);
  const total = response.standings.find((s) => s.type === "TOTAL") ?? response.standings[0];
  const rows = total?.table ?? [];
  standingsCache.set(code, { at: Date.now(), rows });
  return rows;
}

// Standings are an enrichment (like injuries), not a core fact the whole digest depends on — a
// failed or unavailable fetch here just means the infogram doesn't show a table position, never a
// failed analysis. Unlike everything else in fetchFootballDigest, this is allowed to swallow its
// own error rather than let it propagate.
async function fetchCompetitionStandingsRowsSafe(code: string): Promise<FootballDataStandingRow[]> {
  try {
    return await fetchCompetitionStandingsRows(code);
  } catch {
    return [];
  }
}

// Test-only: clears the standings cache so selftest cases don't see stale rows from an earlier
// case sharing the same competition code.
export function __resetStandingsCacheForTests(): void {
  standingsCache.clear();
}

export interface FootballDigest {
  text: string;
  homeStanding: TeamStanding | null;
  awayStanding: TeamStanding | null;
}

interface FootballDigestInput {
  homeTeam: string;
  awayTeam: string;
  league: LeagueId;
  startTime: string;
}

// A short in-memory cache keyed by the exact match, mainly so a *later* research run (or a fresh
// analysis of the same match within a couple of minutes) doesn't repeat calls for data that would
// come back identical every time.
const DIGEST_CACHE_TTL_MS = 2 * 60_000;
const digestCache = new Map<string, { at: number; digest: FootballDigest }>();

// The "research runs" stepper fires several parallel calls for the *same* match at once. Those all
// miss the cache above simultaneously (none of them has finished long enough to have populated it
// yet), so without this they'd each independently repeat the whole ~5-request fetch pipeline —
// N runs would cost N times the API calls for identical data. Tracking the in-flight promise per
// cache key means only the first caller actually talks to football-data.org; every concurrent
// caller for the same match just awaits that same promise.
const inFlightDigestRequests = new Map<string, Promise<FootballDigest>>();

export async function buildFootballDigest(input: FootballDigestInput): Promise<FootballDigest> {
  const cacheKey = `${input.league}|${input.homeTeam}|${input.awayTeam}|${input.startTime}`;
  const cached = digestCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DIGEST_CACHE_TTL_MS) return cached.digest;

  const inFlight = inFlightDigestRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = fetchFootballDigest(input, cacheKey).finally(() => {
    inFlightDigestRequests.delete(cacheKey);
  });
  inFlightDigestRequests.set(cacheKey, request);
  return request;
}

async function fetchFootballDigest(input: FootballDigestInput, cacheKey: string): Promise<FootballDigest> {
  const code = COMPETITION_CODE[input.league];
  if (!code) {
    throw new Error(
      "This league isn't available on football-data.org's free plan (only Premier League, La Liga, Bundesliga, Serie A, " +
        "Ligue 1, Primeira Liga, Eredivisie, and the Champions League are)."
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

  const [homeForm, awayForm, h2h, standingsRows] = await Promise.all([
    fetchForm(home.id),
    fetchForm(away.id),
    fetchHeadToHead(fixture.id),
    fetchCompetitionStandingsRowsSafe(code),
  ]);

  const toStanding = (teamId: number, form: FormLine[]): TeamStanding | null => {
    const row = standingsRows.find((r) => r.team.id === teamId);
    if (!row) return null;
    return {
      position: row.position,
      playedGames: row.playedGames,
      points: row.points,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      form: formLetters(form),
    };
  };
  const homeStanding = toStanding(home.id, homeForm);
  const awayStanding = toStanding(away.id, awayForm);

  const notYetStarted = NOT_YET_STARTED.has(fixture.status);
  const statusLabel = STATUS_LABEL[fixture.status] ?? fixture.status;
  const statusLine = notYetStarted
    ? `Match has not started yet — kickoff scheduled for ${new Date(fixture.utcDate).toUTCString()} (status: ${statusLabel}).`
    : `Match status: ${statusLabel} — current score ${input.homeTeam} ${fixture.score.fullTime.home ?? "?"}-` +
      `${fixture.score.fullTime.away ?? "?"} ${input.awayTeam}, kickoff was ${new Date(fixture.utcDate).toUTCString()}.`;

  const standingsLine = (name: string, s: TeamStanding | null) =>
    s ? `${name}: #${s.position}, ${s.points}pts, ${s.playedGames} played, ${s.goalsFor}-${s.goalsAgainst} goals` : `${name}: not available`;

  const text = `Match Status:
${statusLine}

League Standings:
${standingsLine(input.homeTeam, homeStanding)}
${standingsLine(input.awayTeam, awayStanding)}

${input.homeTeam} Form (last 5 completed matches):
${homeForm.length > 0 ? homeForm.map((f) => `- ${f.date}: ${f.summary}`).join("\n") : "No recent completed fixtures found."}

${input.awayTeam} Form (last 5 completed matches):
${awayForm.length > 0 ? awayForm.map((f) => `- ${f.date}: ${f.summary}`).join("\n") : "No recent completed fixtures found."}

Head-to-Head History (last 5 meetings):
${h2h.length > 0 ? h2h.map((f) => `- ${f.date}: ${f.summary}`).join("\n") : "No previous meetings found."}`;

  const digest: FootballDigest = { text, homeStanding, awayStanding };
  digestCache.set(cacheKey, { at: Date.now(), digest });
  return digest;
}

export interface LiveScoreEntry {
  league: LeagueId;
  homeTeam: string;
  awayTeam: string;
  // football-data.org's own short name for each club, carried alongside the full one because for
  // a good few clubs it's the only form that's recognisable from Polymarket's naming ("Wolves",
  // "Spurs", "Man City", "Inter"). Consumers match against both — see anyTeamNameMatches.
  homeTeamShort?: string;
  awayTeamShort?: string;
  status: string;
  statusLabel: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

// Only these statuses are worth showing on the games list — a scheduled/postponed/cancelled match
// still uses the plain kickoff-time label the card already shows, no enrichment needed for those.
const LIVE_RELEVANT_STATUSES = new Set(["LIVE", "IN_PLAY", "PAUSED", "FINISHED"]);

// Shared across every request to the warm server instance (not per-user), so however many people
// are watching a match at once, a league still costs at most one upstream fetch per TTL. Much
// shorter than the digest cache above, since a live score is only useful fresh.
//
// This is deliberately the same interval the client polls at (app/sports/page.tsx's
// LIVE_SCORE_POLL_MS): matching them means each poll gets genuinely fresh data at a predictable
// cost of one request per live league per minute, which is the point — the free tier allows 10
// requests/minute across the whole app, and the rate limiter above makes an over-budget call WAIT
// rather than fail, so scores polled too eagerly would stall the AI analysis a user actually
// asked for. A longer TTL wouldn't save requests here, it would just serve staler scores.
const LIVE_WINDOW_CACHE_TTL_MS = 60_000;
const liveWindowCache = new Map<string, { at: number; matches: FootballDataMatch[] }>();

function dateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function fetchLeagueMatchesInRange(
  code: string,
  from: string,
  to: string,
  cache: Map<string, { at: number; matches: FootballDataMatch[] }>,
  ttlMs: number
): Promise<FootballDataMatch[]> {
  const cacheKey = `${code}:${from}:${to}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < ttlMs) return cached.matches;

  const response = await footballDataFetch<{ matches: FootballDataMatch[] }>(
    `/matches?competitions=${code}&dateFrom=${from}&dateTo=${to}`
  );
  cache.set(cacheKey, { at: Date.now(), matches: response.matches });
  return response.matches;
}

async function fetchLeagueLiveWindow(code: string): Promise<FootballDataMatch[]> {
  const now = Date.now();
  return fetchLeagueMatchesInRange(
    code,
    dateOnly(now - 86_400_000),
    dateOnly(now + 86_400_000),
    liveWindowCache,
    LIVE_WINDOW_CACHE_TTL_MS
  );
}

// Test-only: clears the live-window cache so selftest cases don't see stale matches from an
// earlier case sharing the same competition code.
export function __resetLiveWindowCacheForTests(): void {
  liveWindowCache.clear();
}

// Enriches the games list with a real live score instead of a guessed "kickoff was recent enough
// that it's probably live" label with no score attached. One request per REQUESTED league (not
// every league this provider covers — checking all 8 unconditionally on every poll was most of
// the free tier's entire 10-requests/minute budget by itself, crowding out real digest-building
// calls into 429s), protected by the same rate limiter as every other call in this module. A
// league whose fetch fails, or one this provider doesn't cover at all, just contributes nothing to
// the result rather than breaking the rest of the games list.
function toLiveScoreEntries(league: LeagueId, matches: FootballDataMatch[]): LiveScoreEntry[] {
  return matches
    .filter((m) => LIVE_RELEVANT_STATUSES.has(m.status))
    .map((m): LiveScoreEntry => ({
      league,
      homeTeam: m.homeTeam.name,
      awayTeam: m.awayTeam.name,
      homeTeamShort: m.homeTeam.shortName,
      awayTeamShort: m.awayTeam.shortName,
      status: m.status,
      statusLabel: STATUS_LABEL[m.status] ?? m.status,
      homeGoals: m.score.fullTime.home,
      awayGoals: m.score.fullTime.away,
    }));
}

export async function getLiveScores(leagues: LeagueId[]): Promise<LiveScoreEntry[]> {
  const entries = await Promise.all(
    [...new Set(leagues)].map(async (league) => {
      const code = COMPETITION_CODE[league];
      if (!code) return [] as LiveScoreEntry[];
      try {
        return toLiveScoreEntries(league, await fetchLeagueLiveWindow(code));
      } catch {
        return [];
      }
    })
  );
  return entries.flat();
}

const MATCH_RESULTS_CACHE_TTL_MS = 5 * 60_000;
const matchResultsCache = new Map<string, { at: number; matches: FootballDataMatch[] }>();
// football-data.org's free tier rejects a dateFrom/dateTo span wider than this (undocumented in
// this codebase, taken from the provider's own published limit) — bounding the lookback to it
// keeps a settlement check for a very stale unsettled bet from erroring out the whole request
// instead of just settling what it still can.
const MAX_SETTLEMENT_LOOKBACK_MS = 10 * 24 * 60 * 60 * 1000;

// Ground truth for settling a placed bet: the real final score of the match it was bet on,
// however long ago it kicked off — unlike getLiveScores (a tight ±1 day window built for "is this
// worth showing on screen right now"), this looks back as far as `earliestKickoff` needs, up to
// MAX_SETTLEMENT_LOOKBACK_MS. One request per league regardless of how many still-unsettled bets
// from that league are being checked. A league whose fetch fails just contributes nothing, same
// as getLiveScores — the caller leaves those bets unsettled rather than guessing.
export async function getMatchResultsSince(
  refs: { league: LeagueId; earliestKickoff: string }[]
): Promise<LiveScoreEntry[]> {
  const now = Date.now();
  const entries = await Promise.all(
    refs.map(async ({ league, earliestKickoff }) => {
      const code = COMPETITION_CODE[league];
      if (!code) return [] as LiveScoreEntry[];
      const kickoffMs = new Date(earliestKickoff).getTime();
      const wanted = Number.isFinite(kickoffMs) ? now - kickoffMs + 86_400_000 : MAX_SETTLEMENT_LOOKBACK_MS;
      const lookbackMs = Math.min(Math.max(wanted, 86_400_000), MAX_SETTLEMENT_LOOKBACK_MS);
      const from = dateOnly(now - lookbackMs);
      const to = dateOnly(now);
      try {
        const matches = await fetchLeagueMatchesInRange(code, from, to, matchResultsCache, MATCH_RESULTS_CACHE_TTL_MS);
        return toLiveScoreEntries(league, matches);
      } catch {
        return [];
      }
    })
  );
  return entries.flat();
}

// Test-only: clears the match-results cache so selftest cases don't see stale matches from an
// earlier case sharing the same competition code and date range.
export function __resetMatchResultsCacheForTests(): void {
  matchResultsCache.clear();
}

import type { LeagueId } from "./types";

// Live scores and settlement results, from ESPN's public site API instead of football-data.org.
// No API key, no documented rate limit (unlike football-data.org's 10-requests/minute free tier,
// shared with AI analysis, which was the actual cause of scores arriving minutes late or not at
// all: a poll queued behind analysis traffic could sit past its own timeout and get killed with
// nothing to show for it). football-data.org still powers the AI digest (form/standings/h2h,
// lib/footballData.ts) — that's a different feature with no equivalent on ESPN's site API.
//
// This is an unofficial, undocumented endpoint (no published guarantees, and it can change
// without notice) — same caveat this codebase already lives with for football-data.org's own
// undocumented behavior. Parsing here is deliberately lenient: anything unexpected degrades to "no
// data for this match" rather than throwing, exactly like every other best-effort enrichment in
// this app. `/api/games/debug`-style raw passthroughs exist elsewhere in this codebase for exactly
// this situation (an API this sandbox can't reach to verify live); if ESPN's real shape ever drifts
// from what's coded here, the fix is narrow — everything downstream (Sports page, settlement) only
// ever sees the normalized LiveScoreEntry shape below, never ESPN's own JSON.
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const REQUEST_TIMEOUT_MS = 10_000;

const ESPN_LEAGUE_SLUG: Record<LeagueId, string> = {
  "premier-league": "eng.1",
  "la-liga": "esp.1",
  bundesliga: "ger.1",
  "ligue-1": "fra.1",
  "serie-a": "ita.1",
  "primeira-liga": "por.1",
  eredivisie: "ned.1",
  "belgian-pro-league": "bel.1",
  "champions-league": "uefa.champions",
};

export interface LiveScoreEntry {
  league: LeagueId;
  homeTeam: string;
  awayTeam: string;
  // ESPN's shorter team name, carried alongside the full one for the same reason
  // football-data.org's shortName was needed before: several clubs are only recognisable from
  // Polymarket's naming under the short form ("Wolves", "Spurs", "Inter Milan").
  homeTeamShort?: string;
  awayTeamShort?: string;
  status: string;
  statusLabel: string;
  // The live match clock as ESPN reports it — "62'", "HT", "45+2'" — or undefined once finished
  // or before kickoff, where a clock has no meaning. This is what actually makes a card feel
  // "live" rather than just eventually correct.
  clockLabel?: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

interface EspnTeam {
  displayName?: string;
  shortDisplayName?: string;
  abbreviation?: string;
}

interface EspnCompetitor {
  homeAway?: "home" | "away";
  team?: EspnTeam;
  score?: string;
}

interface EspnStatusType {
  name?: string;
  state?: "pre" | "in" | "post";
  completed?: boolean;
}

interface EspnStatus {
  type?: EspnStatusType;
  displayClock?: string;
}

interface EspnCompetition {
  status?: EspnStatus;
  competitors?: EspnCompetitor[];
}

interface EspnEvent {
  competitions?: EspnCompetition[];
}

interface EspnScoreboardResponse {
  events?: EspnEvent[];
}

// Our own status vocabulary — unchanged from before, so nothing downstream (isMatchOver,
// GameCard's FT/HT/LIVE label, settlement's "was this FINISHED") needed to change at all when the
// data source underneath it did.
const NOT_STARTED = new Set(["pre"]);

function normalizeStatus(type: EspnStatusType | undefined): { status: string; label: string } {
  if (type?.completed) return { status: "FINISHED", label: "Finished" };
  const name = type?.name ?? "";
  if (name === "STATUS_HALFTIME") return { status: "PAUSED", label: "Halftime/Paused" };
  if (name.includes("POSTPONE")) return { status: "POSTPONED", label: "Postponed" };
  if (name.includes("SUSPEND")) return { status: "SUSPENDED", label: "Suspended" };
  if (name.includes("CANCEL") || name.includes("ABANDON")) return { status: "CANCELED", label: "Cancelled" };
  if (type?.state === "in") return { status: "IN_PLAY", label: "In Play" };
  if (type && !NOT_STARTED.has(type.state ?? "pre")) return { status: "SCHEDULED", label: "Scheduled" };
  return { status: "SCHEDULED", label: "Scheduled" };
}

function clockLabelFor(status: string, displayClock: string | undefined): string | undefined {
  if (status === "FINISHED") return "FT";
  if (status === "PAUSED") return "HT";
  if (status === "IN_PLAY") return displayClock && displayClock.trim().length > 0 ? displayClock.trim() : undefined;
  return undefined;
}

function toGoals(score: string | undefined): number | null {
  if (score === undefined) return null;
  const n = Number(score);
  return Number.isFinite(n) ? n : null;
}

function toLiveScoreEntry(league: LeagueId, event: EspnEvent): LiveScoreEntry | null {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home?.team?.displayName || !away?.team?.displayName) return null;

  const { status, label } = normalizeStatus(competition?.status?.type);
  return {
    league,
    homeTeam: home.team.displayName,
    awayTeam: away.team.displayName,
    homeTeamShort: home.team.shortDisplayName ?? home.team.abbreviation,
    awayTeamShort: away.team.shortDisplayName ?? away.team.abbreviation,
    status,
    statusLabel: label,
    clockLabel: clockLabelFor(status, competition?.status?.displayClock),
    homeGoals: toGoals(home.score),
    awayGoals: toGoals(away.score),
  };
}

function dateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchScoreboard(slug: string, datesParam: string): Promise<EspnEvent[]> {
  const res = await fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${datesParam}&limit=200`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ESPN scoreboard request failed (${res.status}) for ${slug}`);
  const data = (await res.json()) as EspnScoreboardResponse;
  return Array.isArray(data.events) ? data.events : [];
}

// Enriches the games list with a real live score and match clock. One request per requested
// league — a ±1 day window is enough for "is this worth showing on screen right now", the same
// intent getLiveScores has always had. A league whose fetch fails contributes nothing rather than
// breaking the rest of the list.
export async function getLiveScores(leagues: LeagueId[]): Promise<LiveScoreEntry[]> {
  const now = Date.now();
  const datesParam = `${dateOnly(now - 86_400_000)}-${dateOnly(now + 86_400_000)}`;
  const entries = await Promise.all(
    [...new Set(leagues)].map(async (league): Promise<LiveScoreEntry[]> => {
      const slug = ESPN_LEAGUE_SLUG[league];
      if (!slug) return [];
      try {
        const events = await fetchScoreboard(slug, datesParam);
        return events.map((e) => toLiveScoreEntry(league, e)).filter((e): e is LiveScoreEntry => e !== null);
      } catch (err) {
        console.error(`getLiveScores(${league}) failed`, err);
        return [];
      }
    })
  );
  return entries.flat();
}

// Ground truth for settling a placed bet: the real final score, however long ago it kicked off.
// ESPN's scoreboard accepts a wide dates range for historical results the same way it does for
// upcoming fixtures, so this reuses the exact same request shape as getLiveScores — just a wider
// window, bounded by how far back the oldest still-unsettled bet in that league needs.
const MAX_SETTLEMENT_LOOKBACK_MS = 10 * 24 * 60 * 60 * 1000;

export async function getMatchResultsSince(
  refs: { league: LeagueId; earliestKickoff: string }[]
): Promise<LiveScoreEntry[]> {
  const now = Date.now();
  const entries = await Promise.all(
    refs.map(async ({ league, earliestKickoff }): Promise<LiveScoreEntry[]> => {
      const slug = ESPN_LEAGUE_SLUG[league];
      if (!slug) return [];
      const kickoffMs = new Date(earliestKickoff).getTime();
      const wanted = Number.isFinite(kickoffMs) ? now - kickoffMs + 86_400_000 : MAX_SETTLEMENT_LOOKBACK_MS;
      const lookbackMs = Math.min(Math.max(wanted, 86_400_000), MAX_SETTLEMENT_LOOKBACK_MS);
      const datesParam = `${dateOnly(now - lookbackMs)}-${dateOnly(now)}`;
      try {
        const events = await fetchScoreboard(slug, datesParam);
        return events.map((e) => toLiveScoreEntry(league, e)).filter((e): e is LiveScoreEntry => e !== null);
      } catch (err) {
        console.error(`getMatchResultsSince(${league}) failed`, err);
        return [];
      }
    })
  );
  return entries.flat();
}

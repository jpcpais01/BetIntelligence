import type { LeagueId, TeamLineup } from "./types";
import { ESPN_BASE, ESPN_REQUEST_TIMEOUT_MS, ESPN_LEAGUE_SLUG } from "./liveScores";
import { anyTeamNameMatches } from "./teamNameMatching";

// Starting-XI lineups, from the same ESPN site API already powering live scores (lib/liveScores.ts)
// — no API key, no documented rate limit. ESPN publishes a match's confirmed lineup itself
// (usually somewhere from about an hour before kickoff for the top-5 leagues, sometimes much closer
// to it for smaller ones) — never on any guaranteed schedule, so "not available yet" is the normal,
// expected state right up until it isn't. This is an enrichment layer like injuries
// (lib/bigBallsData.ts): a match with nothing posted yet just means the digest/UI says so, never a
// failed analysis.
//
// Unlike live scores (one scoreboard call already returns every match, keyed by team names), a
// lineup lives behind ESPN's own event id — getting it takes two requests: the league's scoreboard
// (to find which event id belongs to this fixture) and then that event's summary (which carries the
// roster once posted). Same undocumented-endpoint caveat as liveScores.ts: parsing here is
// deliberately lenient, degrading to "nothing available" rather than throwing.

interface EspnScoreboardTeam {
  displayName?: string;
  shortDisplayName?: string;
  abbreviation?: string;
}

interface EspnScoreboardCompetitor {
  homeAway?: "home" | "away";
  team?: EspnScoreboardTeam;
}

interface EspnScoreboardEvent {
  id?: string;
  competitions?: { competitors?: EspnScoreboardCompetitor[] }[];
}

interface EspnScoreboardResponse {
  events?: EspnScoreboardEvent[];
}

interface EspnAthlete {
  displayName?: string;
}

interface EspnRosterEntry {
  starter?: boolean;
  athlete?: EspnAthlete;
  position?: { abbreviation?: string };
}

interface EspnRosterTeam {
  homeAway?: "home" | "away";
  formation?: string;
  roster?: EspnRosterEntry[];
}

interface EspnSummaryResponse {
  rosters?: EspnRosterTeam[];
}

function dateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchScoreboardEvents(slug: string, datesParam: string): Promise<EspnScoreboardEvent[]> {
  const res = await fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${datesParam}&limit=200`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(ESPN_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ESPN scoreboard request failed (${res.status}) for ${slug}`);
  const data = (await res.json()) as EspnScoreboardResponse;
  return Array.isArray(data.events) ? data.events : [];
}

// Picks the one event out of a scoreboard's events that matches this fixture by team name (against
// every name ESPN gave each side — full, short, and abbreviation — same reasoning as
// lib/teamNameMatching.ts's anyTeamNameMatches already documents for other providers).
function matchEvent(events: EspnScoreboardEvent[], homeTeam: string, awayTeam: string): EspnScoreboardEvent | null {
  return (
    events.find((event) => {
      const competitors = event.competitions?.[0]?.competitors ?? [];
      const home = competitors.find((c) => c.homeAway === "home")?.team;
      const away = competitors.find((c) => c.homeAway === "away")?.team;
      if (!home || !away) return false;
      return (
        anyTeamNameMatches([home.displayName, home.shortDisplayName, home.abbreviation], homeTeam) &&
        anyTeamNameMatches([away.displayName, away.shortDisplayName, away.abbreviation], awayTeam)
      );
    }) ?? null
  );
}

function toTeamLineup(team: EspnRosterTeam | undefined): TeamLineup | null {
  if (!team || !Array.isArray(team.roster)) return null;
  const starters = team.roster
    .filter((r) => r.starter && r.athlete?.displayName)
    .map((r) => ({ name: r.athlete!.displayName!, position: r.position?.abbreviation }));
  if (starters.length === 0) return null;
  return { formation: team.formation, starters };
}

async function fetchSummaryLineups(slug: string, eventId: string): Promise<{ home: TeamLineup; away: TeamLineup } | null> {
  const res = await fetch(`${ESPN_BASE}/${slug}/summary?event=${eventId}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(ESPN_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as EspnSummaryResponse;
  const rosters = data.rosters ?? [];
  const home = toTeamLineup(rosters.find((r) => r.homeAway === "home"));
  const away = toTeamLineup(rosters.find((r) => r.homeAway === "away"));
  if (!home || !away) return null;
  return { home, away };
}

export interface MatchLineups {
  home: TeamLineup;
  away: TeamLineup;
}

// The full lineup for one match, used when building the AI research digest — always resolves,
// never throws. An uncovered league, no lineup posted yet, or any request failure all mean "not
// available for this match right now".
export async function fetchMatchLineups(input: {
  league: LeagueId;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
}): Promise<MatchLineups | null> {
  const slug = ESPN_LEAGUE_SLUG[input.league];
  if (!slug) return null;

  try {
    const kickoffMs = new Date(input.startTime).getTime();
    if (!Number.isFinite(kickoffMs)) return null;
    const datesParam = `${dateOnly(kickoffMs - 86_400_000)}-${dateOnly(kickoffMs + 86_400_000)}`;
    const events = await fetchScoreboardEvents(slug, datesParam);
    const event = matchEvent(events, input.homeTeam, input.awayTeam);
    if (!event?.id) return null;
    return await fetchSummaryLineups(slug, event.id);
  } catch (err) {
    console.error(`fetchMatchLineups(${input.league}) failed`, err);
    return null;
  }
}

// Batch "has a lineup been posted yet" check for the Sports page's polling badge — one scoreboard
// request per league covered among the given games (never one per game), then one summary request
// per game whose event could actually be matched. A game in a league ESPN doesn't cover, or whose
// fixture/lineup fetch fails, just reads as false rather than breaking the rest of the batch.
export async function getLineupAvailability(
  games: { id: string; league: LeagueId; homeTeam: string; awayTeam: string; startTime: string }[]
): Promise<Record<string, boolean>> {
  const byLeague = new Map<LeagueId, typeof games>();
  for (const g of games) {
    if (!ESPN_LEAGUE_SLUG[g.league]) continue;
    const list = byLeague.get(g.league) ?? [];
    list.push(g);
    byLeague.set(g.league, list);
  }

  const result: Record<string, boolean> = {};
  for (const g of games) result[g.id] = false;

  await Promise.all(
    [...byLeague.entries()].map(async ([league, leagueGames]) => {
      const slug = ESPN_LEAGUE_SLUG[league];
      try {
        const kickoffs = leagueGames.map((g) => new Date(g.startTime).getTime()).filter(Number.isFinite);
        if (kickoffs.length === 0) return;
        const from = Math.min(...kickoffs) - 86_400_000;
        const to = Math.max(...kickoffs) + 86_400_000;
        const events = await fetchScoreboardEvents(slug, `${dateOnly(from)}-${dateOnly(to)}`);

        await Promise.all(
          leagueGames.map(async (g) => {
            const event = matchEvent(events, g.homeTeam, g.awayTeam);
            if (!event?.id) return;
            const lineups = await fetchSummaryLineups(slug, event.id);
            result[g.id] = lineups !== null;
          })
        );
      } catch (err) {
        console.error(`getLineupAvailability(${league}) failed`, err);
      }
    })
  );
  return result;
}

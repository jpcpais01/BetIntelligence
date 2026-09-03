import type { LeagueId } from "./types";

interface TopTeam {
  canonical: string;
  aliases: string[];
}

// Curated "elite" clubs per league, used for the Top Games filter. This is a static,
// hand-picked list (not live table standings), since we have no standings API to key off.
const TOP_TEAMS: Record<LeagueId, TopTeam[]> = {
  "premier-league": [
    { canonical: "Manchester City", aliases: ["Manchester City", "Man City"] },
    { canonical: "Arsenal", aliases: ["Arsenal"] },
    { canonical: "Liverpool", aliases: ["Liverpool"] },
    { canonical: "Manchester United", aliases: ["Manchester United", "Man United", "Man Utd"] },
    { canonical: "Chelsea", aliases: ["Chelsea"] },
  ],
  "la-liga": [
    { canonical: "Real Madrid", aliases: ["Real Madrid"] },
    { canonical: "Barcelona", aliases: ["Barcelona", "FC Barcelona", "Barca"] },
    { canonical: "Atletico Madrid", aliases: ["Atletico Madrid", "Atletico de Madrid", "Atl. Madrid"] },
    { canonical: "Sevilla", aliases: ["Sevilla"] },
    { canonical: "Valencia", aliases: ["Valencia"] },
  ],
  bundesliga: [
    { canonical: "Bayern Munich", aliases: ["Bayern Munich", "Bayern Munchen", "FC Bayern", "Bayern"] },
    { canonical: "Borussia Dortmund", aliases: ["Borussia Dortmund", "Dortmund", "BVB"] },
    { canonical: "RB Leipzig", aliases: ["RB Leipzig", "Leipzig"] },
    { canonical: "Bayer Leverkusen", aliases: ["Bayer Leverkusen", "Leverkusen"] },
    { canonical: "Eintracht Frankfurt", aliases: ["Eintracht Frankfurt", "Frankfurt"] },
  ],
  "serie-a": [
    { canonical: "Juventus", aliases: ["Juventus", "Juve"] },
    { canonical: "Inter Milan", aliases: ["Inter Milan", "Inter", "Internazionale"] },
    { canonical: "AC Milan", aliases: ["AC Milan", "Milan"] },
    { canonical: "Napoli", aliases: ["Napoli"] },
    { canonical: "AS Roma", aliases: ["AS Roma", "Roma"] },
  ],
  "ligue-1": [
    { canonical: "Paris Saint-Germain", aliases: ["Paris Saint-Germain", "Paris Saint Germain", "PSG"] },
    { canonical: "Marseille", aliases: ["Marseille", "Olympique Marseille", "OM"] },
    { canonical: "Lyon", aliases: ["Lyon", "Olympique Lyonnais", "OL"] },
    { canonical: "Monaco", aliases: ["Monaco", "AS Monaco"] },
    { canonical: "Lille", aliases: ["Lille", "LOSC"] },
  ],
  "primeira-liga": [
    { canonical: "Benfica", aliases: ["Benfica", "SL Benfica"] },
    { canonical: "Porto", aliases: ["Porto", "FC Porto"] },
    { canonical: "Sporting CP", aliases: ["Sporting CP", "Sporting Lisbon", "Sporting"] },
    { canonical: "Braga", aliases: ["Braga", "SC Braga"] },
    { canonical: "Vitoria SC", aliases: ["Vitoria SC", "Vitoria Guimaraes", "Vitoria de Guimaraes"] },
  ],
  eredivisie: [
    { canonical: "Ajax", aliases: ["Ajax"] },
    { canonical: "PSV Eindhoven", aliases: ["PSV Eindhoven", "PSV"] },
    { canonical: "Feyenoord", aliases: ["Feyenoord"] },
    { canonical: "AZ Alkmaar", aliases: ["AZ Alkmaar", "AZ"] },
    { canonical: "FC Utrecht", aliases: ["FC Utrecht", "Utrecht"] },
  ],
  "belgian-pro-league": [
    { canonical: "Club Brugge", aliases: ["Club Brugge", "Club Brugge KV"] },
    { canonical: "Anderlecht", aliases: ["Anderlecht", "RSC Anderlecht"] },
    { canonical: "Genk", aliases: ["Genk", "KRC Genk"] },
    { canonical: "Standard Liege", aliases: ["Standard Liege", "Standard de Liege"] },
    { canonical: "Union Saint-Gilloise", aliases: ["Union Saint-Gilloise", "Union SG"] },
  ],
};

const CLUB_STOPWORDS = new Set([
  "fc",
  "cf",
  "afc",
  "cfc",
  "sc",
  "ac",
  "cd",
  "ud",
  "kv",
  "rsc",
  "krc",
  "sl",
  "as",
  "de",
]);

export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && !CLUB_STOPWORDS.has(token))
    .join(" ")
    .trim();
}

type NormalizedIndex = Partial<Record<LeagueId, Set<string>>>;

const NORMALIZED_INDEX: NormalizedIndex = {};
for (const [league, teams] of Object.entries(TOP_TEAMS) as [LeagueId, TopTeam[]][]) {
  NORMALIZED_INDEX[league] = new Set(
    teams.flatMap((t) => t.aliases.map(normalizeTeamName)).filter(Boolean)
  );
}

export function isTopTeam(teamName: string, league: LeagueId): boolean {
  const set = NORMALIZED_INDEX[league];
  if (!set) return false;
  const normalized = normalizeTeamName(teamName);
  if (!normalized) return false;
  if (set.has(normalized)) return true;

  for (const alias of set) {
    if (alias.length < 4) continue;
    if (normalized.includes(alias) || alias.includes(normalized)) return true;
  }
  return false;
}

export function isTopGame(game: { league: LeagueId; homeTeam: string; awayTeam: string }): boolean {
  return isTopTeam(game.homeTeam, game.league) || isTopTeam(game.awayTeam, game.league);
}

export function getTopTeamNames(league: LeagueId): string[] {
  return TOP_TEAMS[league]?.map((t) => t.canonical) ?? [];
}

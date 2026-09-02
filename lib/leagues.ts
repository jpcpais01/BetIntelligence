import type { LeagueId } from "./types";

const ENGLAND_FLAG = String.fromCodePoint(
  0x1f3f4,
  0xe0067,
  0xe0062,
  0xe0065,
  0xe006e,
  0xe0067,
  0xe007f
);

export interface LeagueConfig {
  id: LeagueId;
  name: string;
  shortName: string;
  country: string;
  flag: string;
  keywords: string[];
}

// Order matters: more specific / disambiguating leagues are matched first
// (e.g. Brazil's "Serie A" must be caught before Italy's "Serie A").
export const LEAGUES: LeagueConfig[] = [
  {
    id: "brasileirao",
    name: "Brasileirao",
    shortName: "Brasileirao",
    country: "Brazil",
    flag: "\u{1F1E7}\u{1F1F7}",
    keywords: ["brasileir", "campeonato brasileiro", "brazil serie a", "brazilian serie a"],
  },
  {
    id: "premier-league",
    name: "Premier League",
    shortName: "EPL",
    country: "England",
    flag: ENGLAND_FLAG,
    keywords: ["premier league", "epl", "english premier"],
  },
  {
    id: "la-liga",
    name: "La Liga",
    shortName: "LaLiga",
    country: "Spain",
    flag: "\u{1F1EA}\u{1F1F8}",
    keywords: ["la liga", "laliga", "spanish primera"],
  },
  {
    id: "bundesliga",
    name: "Bundesliga",
    shortName: "Bundesliga",
    country: "Germany",
    flag: "\u{1F1E9}\u{1F1EA}",
    keywords: ["bundesliga"],
  },
  {
    id: "ligue-1",
    name: "Ligue 1",
    shortName: "Ligue 1",
    country: "France",
    flag: "\u{1F1EB}\u{1F1F7}",
    keywords: ["ligue 1"],
  },
  {
    id: "serie-a",
    name: "Serie A",
    shortName: "Serie A",
    country: "Italy",
    flag: "\u{1F1EE}\u{1F1F9}",
    keywords: ["serie a"],
  },
  {
    id: "primeira-liga",
    name: "Primeira Liga",
    shortName: "Primeira",
    country: "Portugal",
    flag: "\u{1F1F5}\u{1F1F9}",
    keywords: ["primeira liga", "liga portugal"],
  },
  {
    id: "eredivisie",
    name: "Eredivisie",
    shortName: "Eredivisie",
    country: "Netherlands",
    flag: "\u{1F1F3}\u{1F1F1}",
    keywords: ["eredivisie"],
  },
  {
    id: "belgian-pro-league",
    name: "Belgian Pro League",
    shortName: "Jupiler",
    country: "Belgium",
    flag: "\u{1F1E7}\u{1F1EA}",
    keywords: ["jupiler pro league", "belgian pro league", "belgian first division"],
  },
];

export function matchLeague(haystacks: string[]): LeagueConfig | null {
  const text = haystacks.filter(Boolean).join(" ").toLowerCase();
  for (const league of LEAGUES) {
    if (league.keywords.some((kw) => text.includes(kw))) {
      return league;
    }
  }
  return null;
}

export function getLeague(id: LeagueId): LeagueConfig {
  const league = LEAGUES.find((l) => l.id === id);
  if (!league) throw new Error(`Unknown league id: ${id}`);
  return league;
}

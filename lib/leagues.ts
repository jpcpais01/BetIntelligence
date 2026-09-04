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
  // Many countries run a league with the same name ("Egypt Premier League", "2. Bundesliga",
  // "Brazil Serie B", women's and youth divisions...). If any of these appear alongside a
  // keyword hit, it's a different competition than the one we want.
  excludeKeywords: string[];
  // Polymarket tag slug(s) for this league's own events. Most leagues have exactly one,
  // confirmed against live data; a couple of smaller ones still carry unverified guesses
  // as extra candidates. Keep this list as short as possible — every slug here is walked
  // through full pagination in parallel, and having many redundant candidates for the
  // busiest leagues (which paginate the most) risks tripping Polymarket's rate limit and
  // having pages silently come back short.
  tagSlugs: string[];
}

const COMMON_EXCLUDES = [
  "women",
  "womens",
  "feminine",
  "femenina",
  "feminina",
  "femminile",
  "frauen",
  "vrouwen",
  "u21",
  "u23",
  "u19",
  "u18",
  "youth",
  "reserve",
];

// Order matters: more specific / disambiguating leagues are matched first
// (e.g. Brazil's "Serie A" must be caught before Italy's "Serie A").
export const LEAGUES: LeagueConfig[] = [
  {
    id: "premier-league",
    name: "Premier League",
    shortName: "EPL",
    country: "England",
    flag: ENGLAND_FLAG,
    keywords: ["premier league", "epl", "english premier"],
    excludeKeywords: [
      ...COMMON_EXCLUDES,
      "egypt",
      "ghana",
      "kenya",
      "nigeria",
      "zambia",
      "zimbabwe",
      "uganda",
      "tanzania",
      "rwanda",
      "malawi",
      "botswana",
      "namibia",
      "south africa",
      "russia",
      "russian",
      "ukrain",
      "belarus",
      "kazakh",
      "armenia",
      "azerbaijan",
      "uzbek",
      "india",
      "indian",
      "bangladesh",
      "nepal",
      "hong kong",
      "malaysia",
      "singapore",
      "thailand",
      "myanmar",
      "cambodia",
      "cyprus",
      "gibraltar",
      "israel",
      "wales",
      "welsh",
      "scottish",
      "scotland",
      "northern ireland",
      "bahrain",
      "qatar",
      "premier league 2",
      "canada",
      "canadian",
      "canpl",
    ],
    // Premier League is an official Polymarket partner league — its actual match-by-match
    // events may route through a series_id rather than any generic tag_slug (see
    // fetchLeaguesBySeries in polymarket.ts), so these are a hedge, not the primary path.
    tagSlugs: ["epl", "premier-league", "english-premier-league"],
  },
  {
    id: "la-liga",
    name: "La Liga",
    shortName: "LaLiga",
    country: "Spain",
    flag: "\u{1F1EA}\u{1F1F8}",
    keywords: ["la liga", "laliga", "spanish primera"],
    excludeKeywords: [
      ...COMMON_EXCLUDES,
      "hypermotion",
      "smartbank",
      "laliga 2",
      "la liga 2",
      "segunda",
      "argentina",
      "liga mx",
    ],
    // La Liga is an official Polymarket partner league — see the Premier League comment above.
    tagSlugs: ["la-liga", "laliga"],
  },
  {
    id: "bundesliga",
    name: "Bundesliga",
    shortName: "Bundesliga",
    country: "Germany",
    flag: "\u{1F1E9}\u{1F1EA}",
    keywords: ["bundesliga"],
    excludeKeywords: [
      ...COMMON_EXCLUDES,
      "2. bundesliga",
      "2 bundesliga",
      "zweite",
      "austria",
      "austrian",
      "osterreich",
      "3. liga",
    ],
    tagSlugs: ["bundesliga"],
  },
  {
    id: "ligue-1",
    name: "Ligue 1",
    shortName: "Ligue 1",
    country: "France",
    flag: "\u{1F1EB}\u{1F1F7}",
    keywords: ["ligue 1"],
    excludeKeywords: [...COMMON_EXCLUDES, "ligue 2"],
    tagSlugs: ["ligue-1"],
  },
  {
    id: "serie-a",
    name: "Serie A",
    shortName: "Serie A",
    country: "Italy",
    flag: "\u{1F1EE}\u{1F1F9}",
    keywords: ["serie a"],
    excludeKeywords: [
      ...COMMON_EXCLUDES,
      "brazil",
      "brasil",
      "brasileir",
      "ecuador",
      "serie a2",
      "serie b",
      "serie c",
    ],
    // Serie A is an official Polymarket partner league — see the Premier League comment above.
    tagSlugs: ["serie-a", "bkseriea", "italy-serie-a"],
  },
  {
    id: "primeira-liga",
    name: "Primeira Liga",
    shortName: "Primeira",
    country: "Portugal",
    flag: "\u{1F1F5}\u{1F1F9}",
    keywords: ["primeira liga", "liga portugal"],
    excludeKeywords: [...COMMON_EXCLUDES, "brazil", "brasil", "liga 2", "liga 3"],
    tagSlugs: ["primeira-liga"],
  },
  {
    id: "eredivisie",
    name: "Eredivisie",
    shortName: "Eredivisie",
    country: "Netherlands",
    flag: "\u{1F1F3}\u{1F1F1}",
    keywords: ["eredivisie"],
    excludeKeywords: [...COMMON_EXCLUDES, "keuken", "eerste"],
    tagSlugs: ["eredivisie", "dutch-eredivisie"],
  },
  {
    id: "belgian-pro-league",
    name: "Belgian Pro League",
    shortName: "Jupiler",
    country: "Belgium",
    flag: "\u{1F1E7}\u{1F1EA}",
    keywords: ["jupiler pro league", "belgian pro league", "belgian first division", "jupiler league"],
    excludeKeywords: [...COMMON_EXCLUDES],
    tagSlugs: ["belgian-pro-league", "jupiler-pro-league", "belgium-pro-league"],
  },
  {
    id: "champions-league",
    name: "Champions League",
    shortName: "UCL",
    country: "Europe",
    flag: "\u{1F3C6}",
    keywords: ["champions league", "uefa champions league", "ucl"],
    excludeKeywords: [...COMMON_EXCLUDES],
    tagSlugs: ["champions-league", "uefa-champions-league", "ucl"],
  },
];

function normalizeHaystack(haystacks: string[]): string {
  return haystacks
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A handful of exclude keywords end in a digit (e.g. "premier league 2", meant to filter out
// the youth/reserve "Premier League 2" competition; "la liga 2", the actual second division).
// Real season series carry a year suffix ("Premier League 2025", "La Liga 2026"), and a plain
// substring check can't tell "2" (the standalone competition) from "2" as the first digit of
// "2025" -- so every real top-flight fixture whose series/tags text included a season year was
// silently excluded by the very keyword meant to filter out an unrelated division. A trailing
// negative lookahead for another digit fixes that without weakening the exclusion itself.
function matchesExcludeKeyword(text: string, keyword: string): boolean {
  if (/\d$/.test(keyword)) {
    return new RegExp(`${escapeRegExp(keyword)}(?!\\d)`).test(text);
  }
  return text.includes(keyword);
}

export function matchLeague(haystacks: string[]): LeagueConfig | null {
  const text = normalizeHaystack(haystacks);
  for (const league of LEAGUES) {
    if (!league.keywords.some((kw) => text.includes(kw))) continue;
    if (league.excludeKeywords.some((kw) => matchesExcludeKeyword(text, kw))) continue;
    return league;
  }
  return null;
}

export function getLeague(id: LeagueId): LeagueConfig {
  const league = LEAGUES.find((l) => l.id === id);
  if (!league) throw new Error(`Unknown league id: ${id}`);
  return league;
}

// Server-side: validates a (possibly untrusted, client-supplied) league id before it's used to
// look up an API-Football league id or run any other lookup keyed by LeagueId.
export function isLeagueId(value: unknown): value is LeagueId {
  return typeof value === "string" && LEAGUES.some((l) => l.id === value);
}

import { matchLeague, LEAGUES, type LeagueConfig } from "./leagues";
import { normalizeTeamName } from "./topTeams";
import type { Game } from "./types";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

interface RawMarket {
  question?: string;
  groupItemTitle?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  volume?: string | number;
  liquidity?: string | number;
  startDate?: string;
}

interface RawEvent {
  id: string;
  slug: string;
  title: string;
  startDate?: string;
  volume?: string | number;
  liquidity?: string | number;
  tags?: { label?: string; slug?: string }[];
  series?: { title?: string; slug?: string }[];
  markets?: RawMarket[];
}

interface RawTag {
  id: string | number;
  slug?: string;
  label?: string;
}

// Sub-markets that sometimes ride along in the same event (totals, BTTS, corners, etc.)
// and must not be mistaken for a 1X2 home/draw/away outcome.
const NON_MONEYLINE_LABEL = /over|under|total|btts|both teams|corner|card|handicap|clean sheet|to score|exact score/i;

export interface FetchDiagnostics {
  strategy: string;
  rawEventsFetched: number;
  eventsWithMarkets: number;
  eventsMatchingLeague: number;
  eventsWithParsedOutcomes: number;
  finalGames: number;
  sampleRejectedTitles: string[];
  requestErrors: string[];
}

function parseArrayField(field: string | string[] | undefined): string[] {
  if (!field) return [];
  if (Array.isArray(field)) return field;
  try {
    const parsed = JSON.parse(field);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toNumber(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

interface FetchResult<T> {
  data: T | null;
  error?: string;
}

async function getJson<T>(path: string, params: URLSearchParams): Promise<FetchResult<T>> {
  const url = `${GAMMA_BASE}${path}?${params.toString()}`;
  try {
    const res = await fetch(url, {
      next: { revalidate: 45 },
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const error = `${path} -> HTTP ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`;
      console.error(`Polymarket request failed: ${error}`);
      return { data: null, error };
    }
    const json = (await res.json()) as T;
    return { data: json };
  } catch (err) {
    const error = `${path} threw: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`Polymarket request error: ${error}`);
    return { data: null, error };
  }
}

function eventLeagueFields(e: RawEvent): string[] {
  return [
    e.title,
    e.slug,
    ...(e.tags ?? []).map((t) => `${t.label ?? ""} ${t.slug ?? ""}`),
    ...(e.series ?? []).map((s) => `${s.title ?? ""} ${s.slug ?? ""}`),
  ];
}

function eventMatchesTargetLeague(e: RawEvent): boolean {
  return matchLeague(eventLeagueFields(e)) !== null;
}

function extractEventsArray(data: unknown): RawEvent[] {
  if (Array.isArray(data)) return data as RawEvent[];
  if (data && typeof data === "object" && Array.isArray((data as { events?: unknown }).events)) {
    return (data as { events: RawEvent[] }).events;
  }
  return [];
}

async function fetchEventsByParams(
  params: URLSearchParams
): Promise<{ events: RawEvent[]; error?: string }> {
  const { data, error } = await getJson<unknown>("/events", params);
  return { events: extractEventsArray(data), error };
}

async function fetchAllTags(): Promise<{ tags: RawTag[]; error?: string }> {
  const { data, error } = await getJson<unknown>("/tags", new URLSearchParams({ limit: "1000" }));
  return { tags: Array.isArray(data) ? (data as RawTag[]) : [], error };
}

async function discoverSoccerTagId(): Promise<{ tagId: string | null; error?: string }> {
  const { tags, error } = await fetchAllTags();
  const match = tags.find((t) => {
    const s = `${t.slug ?? ""} ${t.label ?? ""}`.toLowerCase();
    return s.includes("soccer") || s.includes("football");
  });
  return { tagId: match ? String(match.id) : null, error };
}

// Each individual match on Polymarket carries its own league-specific tag (confirmed from
// real data, e.g. {"label":"La Liga","slug":"la-liga"} or {"label":"Japan J2 League",...}),
// separate from the broad "soccer" category tag. Querying per-league keeps every request
// small — /events appears capped around ~100 results regardless of the requested limit, and
// globally there are apparently thousands of active "soccer"-tagged events across dozens of
// minor leagues worldwide, so a single broad fetch can easily miss our specific target leagues.
function findLeagueTag(tags: RawTag[], league: LeagueConfig): RawTag | null {
  for (const tag of tags) {
    const text = `${tag.label ?? ""} ${(tag.slug ?? "").replace(/-/g, " ")}`.toLowerCase();
    if (league.keywords.some((kw) => text.includes(kw))) return tag;
  }
  return null;
}

async function fetchEventsPerLeagueTags(): Promise<{
  events: RawEvent[];
  leaguesFound: string[];
  leaguesMissing: string[];
  errors: string[];
}> {
  const errors: string[] = [];
  const { tags, error: tagsError } = await fetchAllTags();
  if (tagsError) errors.push(tagsError);
  if (tags.length === 0) {
    return { events: [], leaguesFound: [], leaguesMissing: LEAGUES.map((l) => l.id), errors };
  }

  const leaguesFound: string[] = [];
  const leaguesMissing: string[] = [];
  const seen = new Set<string>();
  const merged: RawEvent[] = [];

  for (const league of LEAGUES) {
    const tag = findLeagueTag(tags, league);
    if (!tag) {
      leaguesMissing.push(league.id);
      continue;
    }
    leaguesFound.push(league.id);

    const params = new URLSearchParams({ closed: "false", active: "true", limit: "100" });
    if (tag.slug) params.set("tag_slug", tag.slug);
    else params.set("tag_id", String(tag.id));

    const { events, error } = await fetchEventsByParams(params);
    if (error) errors.push(error);
    for (const e of events) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        merged.push(e);
      }
    }
  }

  return { events: merged, leaguesFound, leaguesMissing, errors };
}

async function fetchEventsBroad(
  maxPages = 4,
  pageSize = 500
): Promise<{ events: RawEvent[]; errors: string[] }> {
  const all: RawEvent[] = [];
  const errors: string[] = [];
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      closed: "false",
      active: "true",
      limit: String(pageSize),
      offset: String(page * pageSize),
    });
    const { events, error } = await fetchEventsByParams(params);
    if (error) errors.push(error);
    if (events.length === 0) break;
    all.push(...events);
    if (events.length < pageSize) break;
  }
  return { events: all, errors };
}

// Polymarket tags this generic "games" bucket (as opposed to futures/outrights like
// "2027 Champion") across every sport, so combined with our own league-keyword filter
// it should isolate actual head-to-head matches without needing a per-sport tag.
const GAMES_ONLY_TAG_ID = "100639";

async function fetchSoccerEvents(): Promise<{
  events: RawEvent[];
  strategy: string;
  errors: string[];
}> {
  const errors: string[] = [];
  let bestEvents: RawEvent[] = [];
  let bestStrategy = "none";

  const perLeague = await fetchEventsPerLeagueTags();
  errors.push(...perLeague.errors);
  if (perLeague.events.length > 0) {
    bestEvents = perLeague.events;
    bestStrategy = `per-league-tags (found: ${perLeague.leaguesFound.join(",") || "none"}; missing: ${perLeague.leaguesMissing.join(",") || "none"})`;
  }
  if (perLeague.events.some(eventMatchesTargetLeague)) {
    return { events: perLeague.events, strategy: bestStrategy, errors };
  }

  const attempts: [string, URLSearchParams][] = [
    [
      `tag_id=${GAMES_ONLY_TAG_ID} (games only)`,
      new URLSearchParams({ closed: "false", active: "true", limit: "500", tag_id: GAMES_ONLY_TAG_ID }),
    ],
    [
      "tag_slug=soccer",
      new URLSearchParams({ closed: "false", active: "true", limit: "300", tag_slug: "soccer" }),
    ],
    [
      "tag_slug=football",
      new URLSearchParams({ closed: "false", active: "true", limit: "300", tag_slug: "football" }),
    ],
  ];

  for (const [label, params] of attempts) {
    const { events, error } = await fetchEventsByParams(params);
    if (error) errors.push(error);
    if (events.length > bestEvents.length) {
      bestEvents = events;
      bestStrategy = label;
    }
    if (events.some(eventMatchesTargetLeague)) {
      return { events, strategy: label, errors };
    }
  }

  const { tagId, error: tagError } = await discoverSoccerTagId();
  if (tagError) errors.push(tagError);
  if (tagId) {
    const { events, error } = await fetchEventsByParams(
      new URLSearchParams({ closed: "false", active: "true", limit: "300", tag_id: tagId })
    );
    if (error) errors.push(error);
    if (events.length > bestEvents.length) {
      bestEvents = events;
      bestStrategy = `tag_id=${tagId}`;
    }
    if (events.some(eventMatchesTargetLeague)) {
      return { events, strategy: `tag_id=${tagId}`, errors };
    }
  }

  const { events: broad, errors: broadErrors } = await fetchEventsBroad();
  errors.push(...broadErrors);
  if (broad.some(eventMatchesTargetLeague) || broad.length > bestEvents.length) {
    return { events: broad, strategy: "broad+keyword", errors };
  }

  return { events: bestEvents, strategy: bestStrategy, errors };
}

function extractTeamsFromTitle(eventTitle: string): { home: string; away: string } | null {
  const vsMatch = eventTitle.match(/^(.+?)\s+(?:vs\.?|v\.?|@)\s+(.+)$/i);
  if (vsMatch) {
    return { home: vsMatch[1].trim(), away: vsMatch[2].trim() };
  }
  return null;
}

function normalizeProbabilities(home: number, draw: number, away: number): Game["odds"] | null {
  const sum = home + draw + away;
  if (sum <= 0) return null;
  return {
    home: home / sum,
    draw: draw / sum,
    away: away / sum,
  };
}

interface OutcomeEntry {
  label: string;
  price: number;
}

function collectOutcomeEntries(markets: RawMarket[]): OutcomeEntry[] {
  const entries: OutcomeEntry[] = [];

  for (const market of markets) {
    const outcomes = parseArrayField(market.outcomes);
    const prices = parseArrayField(market.outcomePrices).map((p) => parseFloat(p));

    if (outcomes.length === 3 && prices.length === 3) {
      // A single market already modeling all three 1X2 outcomes.
      outcomes.forEach((label, i) => {
        if (label && Number.isFinite(prices[i]) && !NON_MONEYLINE_LABEL.test(label)) {
          entries.push({ label, price: prices[i] });
        }
      });
      continue;
    }

    // A binary Yes/No market representing a single side of the 1X2.
    const label = market.groupItemTitle || market.question || "";
    if (!label || NON_MONEYLINE_LABEL.test(label)) continue;

    const lowerOutcomes = outcomes.map((o) => o.toLowerCase());
    const yesIdx = lowerOutcomes.indexOf("yes");
    const price = yesIdx >= 0 ? prices[yesIdx] : prices[0];
    if (Number.isFinite(price)) entries.push({ label, price });
  }

  return entries;
}

function marketVolume(markets: RawMarket[]): number {
  return markets.reduce((sum, m) => sum + toNumber(m.volume), 0);
}

function marketLiquidity(markets: RawMarket[]): number {
  return markets.reduce((sum, m) => sum + toNumber(m.liquidity), 0);
}

// Polymarket splits extra bet types for the same match into separate companion events
// (e.g. "Team A vs. Team B - Halftime Result", "- More Markets", "- Exact Score"). Those
// can carry their own valid-looking 3-way structure (home/draw/away at halftime, say), so
// they must be rejected by title before parsing, not just by individual market labels.
const DERIVATIVE_EVENT_SUFFIX =
  /\s-\s(more markets|halftime result|second half result|exact score|first team to score|total corners|both teams to score|correct score|to qualify)\s*$/i;

function parseEvent(event: RawEvent): Game | null {
  if (!event.markets || event.markets.length === 0) return null;
  if (DERIVATIVE_EVENT_SUFFIX.test(event.title)) return null;

  const league = matchLeague(eventLeagueFields(event));
  if (!league) return null;

  const entries = collectOutcomeEntries(event.markets);
  if (entries.length < 3) return null;

  const drawEntry = entries.find((e) => /draw|tie/i.test(e.label));
  if (!drawEntry) return null;

  const teamEntries = entries.filter((e) => e !== drawEntry);
  const byNormalizedLabel = new Map<string, OutcomeEntry>();
  for (const e of teamEntries) {
    const key = normalizeTeamName(e.label);
    if (key && !byNormalizedLabel.has(key)) byNormalizedLabel.set(key, e);
  }
  const uniqueTeamEntries = [...byNormalizedLabel.values()];
  if (uniqueTeamEntries.length !== 2) return null;

  let [teamA, teamB] = uniqueTeamEntries;

  const titleTeams = extractTeamsFromTitle(event.title);
  if (titleTeams) {
    const normalizedHome = normalizeTeamName(titleTeams.home);
    const normalizedA = normalizeTeamName(teamA.label);
    const aIsHome = normalizedHome.includes(normalizedA) || normalizedA.includes(normalizedHome);
    if (!aIsHome) [teamA, teamB] = [teamB, teamA];
  }

  const odds = normalizeProbabilities(teamA.price, drawEntry.price, teamB.price);
  if (!odds) return null;

  return {
    id: event.id,
    slug: event.slug,
    league: league.id,
    leagueName: league.name,
    leagueFlag: league.flag,
    homeTeam: titleTeams?.home ?? teamA.label,
    awayTeam: titleTeams?.away ?? teamB.label,
    startTime: event.startDate || event.markets[0]?.startDate || new Date().toISOString(),
    odds,
    volume: toNumber(event.volume) || marketVolume(event.markets),
    liquidity: toNumber(event.liquidity) || marketLiquidity(event.markets),
    polymarketUrl: `https://polymarket.com/event/${event.slug}`,
  };
}

function withinWindow(startTime: string): boolean {
  const now = Date.now();
  const horizon = now + 14 * 24 * 60 * 60 * 1000;
  const grace = now - 3 * 60 * 60 * 1000;
  const t = new Date(startTime).getTime();
  return Number.isFinite(t) && t >= grace && t <= horizon;
}

export async function getUpcomingGames(): Promise<Game[]> {
  const { events, errors } = await fetchSoccerEvents();

  if (events.length === 0 && errors.length > 0) {
    throw new Error(`Could not reach Polymarket: ${errors[errors.length - 1]}`);
  }

  const games = events
    .map(parseEvent)
    .filter((g): g is Game => g !== null)
    .filter((g) => withinWindow(g.startTime))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return games;
}

export async function getFetchDiagnostics(): Promise<FetchDiagnostics> {
  const { events, strategy, errors } = await fetchSoccerEvents();
  const eventsWithMarkets = events.filter((e) => (e.markets?.length ?? 0) > 0);

  const eventsMatchingLeague = eventsWithMarkets.filter(eventMatchesTargetLeague);

  const parsedGames = eventsMatchingLeague
    .map((e) => ({ event: e, game: parseEvent(e) }))
    .filter((r) => r.game !== null);

  const finalGames = parsedGames.map((r) => r.game as Game).filter((g) => withinWindow(g.startTime));

  const rejected = eventsMatchingLeague
    .filter((e) => parseEvent(e) === null)
    .slice(0, 8)
    .map((e) => e.title);

  return {
    strategy,
    rawEventsFetched: events.length,
    eventsWithMarkets: eventsWithMarkets.length,
    eventsMatchingLeague: eventsMatchingLeague.length,
    eventsWithParsedOutcomes: parsedGames.length,
    finalGames: finalGames.length,
    sampleRejectedTitles: rejected,
    requestErrors: errors,
  };
}

const MATCH_LIKE_TITLE = /\bvs\.?\b|\bv\.?\b|@/i;

function trimMarketForDebug(m: RawMarket) {
  return {
    question: m.question,
    groupItemTitle: m.groupItemTitle,
    outcomes: m.outcomes,
    outcomePrices: m.outcomePrices,
    startDate: m.startDate,
  };
}

function trimEventForDebug(e: RawEvent) {
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    startDate: e.startDate,
    tags: (e.tags ?? []).map((t) => ({ label: t.label, slug: t.slug })),
    series: (e.series ?? []).map((s) => ({ title: s.title, slug: s.slug })),
    markets: (e.markets ?? []).map(trimMarketForDebug),
  };
}

export interface RawSample {
  strategy: string;
  totalFetched: number;
  titles: string[];
  matchLikeEvents: ReturnType<typeof trimEventForDebug>[];
  leagueMatchedEvents: ReturnType<typeof trimEventForDebug>[];
}

export async function getRawSample(): Promise<RawSample> {
  const { events, strategy } = await fetchSoccerEvents();

  const matchLikeEvents = events.filter((e) => MATCH_LIKE_TITLE.test(e.title)).slice(0, 4);
  const leagueMatchedEvents = events.filter(eventMatchesTargetLeague).slice(0, 4);

  return {
    strategy,
    totalFetched: events.length,
    titles: events.map((e) => e.title),
    matchLikeEvents: matchLikeEvents.map(trimEventForDebug),
    leagueMatchedEvents: leagueMatchedEvents.map(trimEventForDebug),
  };
}

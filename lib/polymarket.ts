import { matchLeague, LEAGUES } from "./leagues";
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
  gameStartTime?: string;
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

// Sub-markets that sometimes ride along in the same event (totals, BTTS, corners, etc.)
// and must not be mistaken for a 1X2 home/draw/away outcome.
const NON_MONEYLINE_LABEL = /over|under|total|btts|both teams|corner|card|handicap|clean sheet|to score|exact score/i;

export interface FetchDiagnostics {
  strategy: string;
  rawEventsFetched: number;
  eventsWithMarkets: number;
  eventsMatchingLeague: number;
  eventsWithParsedOutcomes: number;
  droppedByTimeWindow: number;
  finalGames: number;
  matchedEventsByLeague: Record<string, number>;
  gamesByLeague: Record<string, number>;
  sampleRejectedTitles: string[];
  sampleParsedKickoffs: { title: string; startTime: string }[];
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

const PAGE_SIZE = 100;
// The API rejects deep offsets outright ("offset too large, use /events/keyset"), which
// caps a broad sweep at roughly 2100 rows. Per-league queries stay far below that.
const MAX_SWEEP_PAGES = 20;
const MAX_LEAGUE_PAGES = 12;
const PAGE_BATCH = 6;

// /events returns at most ~100 rows per request no matter what limit is asked for, so
// anything broad has to be walked with offset. Page 0 is fetched alone (so a slug that
// returns nothing costs exactly one request); the rest go in small parallel batches, and
// the walk stops as soon as a short page shows we've reached the end.
async function fetchPaginated(
  base: Record<string, string>,
  maxPages: number
): Promise<{ events: RawEvent[]; errors: string[] }> {
  const events: RawEvent[] = [];
  const errors: string[] = [];

  const fetchPage = (page: number) =>
    fetchEventsByParams(
      new URLSearchParams({
        ...base,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      })
    );

  const first = await fetchPage(0);
  if (first.error) errors.push(first.error);
  events.push(...first.events);
  if (first.events.length < PAGE_SIZE) return { events, errors };

  let reachedEnd = false;
  for (let start = 1; start < maxPages && !reachedEnd; start += PAGE_BATCH) {
    const pageNumbers: number[] = [];
    for (let p = start; p < Math.min(start + PAGE_BATCH, maxPages); p++) pageNumbers.push(p);

    const results = await Promise.all(pageNumbers.map(fetchPage));

    for (const result of results) {
      if (result.error) errors.push(result.error);
      events.push(...result.events);
      if (result.events.length < PAGE_SIZE) reachedEnd = true;
    }
  }

  return { events, errors };
}

async function fetchEventsBroad(): Promise<{ events: RawEvent[]; errors: string[] }> {
  return fetchPaginated({ closed: "false", active: "true" }, 10);
}

// Two complementary passes, merged rather than "first one that works wins":
//   1. Each league's own tag slug (precise; a wrong guess just returns nothing).
//   2. A full paginated sweep of the broad soccer tag, which is known to contain real
//      match events — the earlier single-page version only ever saw the first 100 of
//      several thousand worldwide soccer events, which is why our leagues never appeared.
async function fetchSoccerEvents(): Promise<{
  events: RawEvent[];
  strategy: string;
  errors: string[];
}> {
  const errors: string[] = [];
  const seen = new Set<string>();
  const merged: RawEvent[] = [];
  const strategies: string[] = [];

  const addAll = (incoming: RawEvent[]) => {
    for (const e of incoming) {
      if (e?.id && !seen.has(e.id)) {
        seen.add(e.id);
        merged.push(e);
      }
    }
  };

  const slugAttempts = LEAGUES.flatMap((league) =>
    league.tagSlugs.map((slug) => ({ leagueId: league.id, slug }))
  );

  // Each league slug is walked to exhaustion, not just its first page: several of these
  // tags hold well over 100 events, and taking only page 0 returned an arbitrary slice
  // that happened to contain futures/companion events rather than the upcoming fixtures.
  const slugResults = await Promise.all(
    slugAttempts.map(async (attempt) => {
      const result = await fetchPaginated(
        { closed: "false", active: "true", tag_slug: attempt.slug },
        MAX_LEAGUE_PAGES
      );
      return { ...attempt, ...result };
    })
  );

  const workingSlugs: string[] = [];
  for (const result of slugResults) {
    errors.push(...result.errors);
    if (result.events.length > 0) {
      workingSlugs.push(`${result.slug}=${result.events.length}`);
      addAll(result.events);
    }
  }
  if (workingSlugs.length > 0) strategies.push(`league-slugs(${workingSlugs.join(",")})`);

  const sweep = await fetchPaginated(
    { closed: "false", active: "true", tag_slug: "soccer" },
    MAX_SWEEP_PAGES
  );
  errors.push(...sweep.errors);
  if (sweep.events.length > 0) {
    addAll(sweep.events);
    strategies.push(`soccer-sweep(${sweep.events.length})`);
  }

  if (merged.length === 0) {
    const broad = await fetchEventsBroad();
    errors.push(...broad.errors);
    addAll(broad.events);
    strategies.push(`broad(${broad.events.length})`);
  }

  return { events: merged, strategy: strategies.join(" + ") || "none", errors };
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

// event.startDate (and market.startDate) turned out to reflect when the market was opened
// for trading, not the actual kickoff — e.g. a real match's markets carried startDate values
// from over a week before the date named in their own question text ("Will X win on
// 2026-03-08?"). market.gameStartTime is the correct kickoff field when present; otherwise
// fall back to parsing the date out of the question text, and only then to event.startDate.
function extractDateFromQuestion(question: string | undefined): string | null {
  if (!question) return null;
  const match = question.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return match ? match[1] : null;
}

function resolveKickoff(event: RawEvent): string {
  const markets = event.markets ?? [];

  for (const m of markets) {
    if (m.gameStartTime) return m.gameStartTime;
  }

  for (const m of markets) {
    const date = extractDateFromQuestion(m.question);
    if (date) {
      const iso = new Date(date).toISOString();
      if (!Number.isNaN(new Date(iso).getTime())) return iso;
    }
  }

  return event.startDate || markets[0]?.startDate || new Date().toISOString();
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
    startTime: resolveKickoff(event),
    odds,
    volume: toNumber(event.volume) || marketVolume(event.markets),
    liquidity: toNumber(event.liquidity) || marketLiquidity(event.markets),
    polymarketUrl: `https://polymarket.com/event/${event.slug}`,
  };
}

function withinWindow(startTime: string): boolean {
  const now = Date.now();
  const horizon = now + 14 * 24 * 60 * 60 * 1000;
  // Wide grace window: a question-text date fallback (see resolveKickoff) has no time-of-day,
  // so it resolves to 00:00 UTC that day and would otherwise look "already over" almost always.
  const grace = now - 24 * 60 * 60 * 1000;
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

  const allParsedGames = parsedGames.map((r) => r.game as Game);
  const finalGames = allParsedGames.filter((g) => withinWindow(g.startTime));

  const rejected = eventsMatchingLeague
    .filter((e) => parseEvent(e) === null)
    .slice(0, 8)
    .map((e) => e.title);

  const sampleParsedKickoffs = allParsedGames
    .slice(0, 10)
    .map((g) => ({ title: `${g.homeTeam} vs ${g.awayTeam}`, startTime: g.startTime }));

  const matchedEventsByLeague: Record<string, number> = {};
  for (const e of eventsMatchingLeague) {
    const league = matchLeague(eventLeagueFields(e));
    if (league) matchedEventsByLeague[league.id] = (matchedEventsByLeague[league.id] ?? 0) + 1;
  }

  const gamesByLeague: Record<string, number> = {};
  for (const g of finalGames) {
    gamesByLeague[g.league] = (gamesByLeague[g.league] ?? 0) + 1;
  }

  return {
    strategy,
    rawEventsFetched: events.length,
    eventsWithMarkets: eventsWithMarkets.length,
    eventsMatchingLeague: eventsMatchingLeague.length,
    eventsWithParsedOutcomes: parsedGames.length,
    droppedByTimeWindow: allParsedGames.length - finalGames.length,
    finalGames: finalGames.length,
    matchedEventsByLeague,
    gamesByLeague,
    sampleRejectedTitles: rejected,
    sampleParsedKickoffs,
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
    gameStartTime: m.gameStartTime,
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

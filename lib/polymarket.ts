import { matchLeague, LEAGUES } from "./leagues";
import { normalizeTeamName, getTopTeamNames } from "./topTeams";
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
  partnerLeagueMatchLikeRejections: number;
  partnerLeagueNonMatchLikeRejections: number;
  samplePartnerLeagueRejections: {
    title: string;
    league: string | undefined;
    matchLikeTitle: boolean;
    labels: string[];
  }[];
  sampleParsedKickoffs: { title: string; startTime: string }[];
  requestErrors: string[];
  // How many /series objects were actually retrieved (across the unfiltered pagination sweep
  // and the categories_labels-filtered attempts) and a sample of them — added because the
  // series_id discovery path kept finding zero matches with no error to explain why, so this
  // shows the real response shape/content directly instead of requiring another guess-and-check
  // round trip through a human pasting debug output.
  seriesFetched: number;
  sampleSeries: { id?: string | number; slug?: string; title?: string }[];
  // Match-like-titled events naming two known premier-league/la-liga/serie-a clubs that
  // matchLeague() could NOT assign to any league at all (no identifying tag/series text) —
  // rules in or out whether a real fixture is hiding untagged in the raw pool entirely.
  unmatchedPartnerLeagueFixtures: { title: string; tags: string[]; series: string[] }[];
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
      // A full league sweep is expensive (many requests), so cache each page's result for a
      // while — long enough that concurrent users and rapid client refreshes reuse it rather
      // than re-triggering the whole sweep, short enough that odds don't go stale for long.
      next: { revalidate: 180 },
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
const MAX_LEAGUE_PAGES = 15;
const PAGE_RETRIES = 2;

// Caps how many Polymarket requests are ever in flight at once across the ENTIRE fetch —
// not just within one league's pagination. Firing dozens of paginated sweeps in parallel
// (one per league tag) previously meant 100+ concurrent requests, which is enough to trip
// rate limiting; a failed page then looked identical to "no more results" (see fetchPage
// below for why that stopped being true) and silently truncated exactly the leagues that
// generate the most pages — Premier League, La Liga, Serie A.
const MAX_CONCURRENT_REQUESTS = 8;

class RequestGate {
  private active = 0;
  private queue: (() => void)[] = [];

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENT_REQUESTS) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const gate = new RequestGate();

// A page that errored (rate limit, transient 5xx) is retried a couple of times rather than
// treated as "reached the end" — those look identical (both return zero events) unless we
// distinguish them explicitly, and conflating them is what silently truncated results.
async function fetchPageWithRetry(
  base: Record<string, string>,
  page: number
): Promise<{ events: RawEvent[]; error?: string; failed: boolean }> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= PAGE_RETRIES; attempt++) {
    const result = await gate.run(() =>
      fetchEventsByParams(
        new URLSearchParams({ ...base, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) })
      )
    );
    if (!result.error) return { events: result.events, failed: false };
    lastError = result.error;
    if (attempt < PAGE_RETRIES) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }

  return { events: [], error: lastError, failed: true };
}

// /events returns at most ~100 rows per request no matter what limit is asked for, so
// anything broad has to be walked with offset. The walk stops only once a page that
// actually SUCCEEDED comes back short — a failed page (see fetchPageWithRetry) never
// signals the end on its own, it just contributes no rows for that slice.
async function fetchPaginated(
  base: Record<string, string>,
  maxPages: number
): Promise<{ events: RawEvent[]; errors: string[] }> {
  const events: RawEvent[] = [];
  const errors: string[] = [];

  const first = await fetchPageWithRetry(base, 0);
  if (first.error) errors.push(first.error);
  events.push(...first.events);
  if (!first.failed && first.events.length < PAGE_SIZE) return { events, errors };

  let reachedEnd = false;
  for (let page = 1; page < maxPages && !reachedEnd; page++) {
    const result = await fetchPageWithRetry(base, page);
    if (result.error) errors.push(result.error);
    events.push(...result.events);
    if (!result.failed && result.events.length < PAGE_SIZE) reachedEnd = true;
  }

  return { events, errors };
}

async function fetchEventsBroad(): Promise<{ events: RawEvent[]; errors: string[] }> {
  return fetchPaginated({ closed: "false", active: "true" }, 10);
}

interface RawSeries {
  id?: string | number;
  slug?: string;
  title?: string;
}

const MAX_SERIES_PAGES = 15;

function extractSeriesArray(data: unknown): RawSeries[] {
  if (Array.isArray(data)) return data as RawSeries[];
  if (data && typeof data === "object") {
    for (const key of ["series", "data", "results"]) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as RawSeries[];
    }
  }
  return [];
}

// Real /series objects have proper {id, slug, title} fields — confirmed against Polymarket's
// own API docs (github.com/Polymarket/agent-skills) and a third-party Go client's typed
// struct definitions, since gamma-api.polymarket.com itself isn't reachable to verify directly
// in this environment. The previous approach (parsing /sports' embedded "series" field) was
// silently broken: that field is a STRING on that endpoint, not an array of series objects —
// `Array.isArray(s.series)` was always false, so it found zero matches every time, no matter
// what shape the caller assumed. /series is the dedicated, documented endpoint instead.
//
// Two passes: an unfiltered pagination sweep (in case /series ignores category filtering or
// uses a different label than guessed), AND a category-filtered attempt (in case the platform
// has thousands of non-sports recurring series that would otherwise push soccer leagues past
// the unfiltered sweep's page cap before ever reaching them). Merged and deduped by id.
async function fetchAllSeries(): Promise<{ series: RawSeries[]; errors: string[]; pagesFetched: number }> {
  const errors: string[] = [];
  const collected = new Map<string, RawSeries>();
  let pagesFetched = 0;

  const addAll = (batch: RawSeries[]) => {
    for (const s of batch) {
      const key = s.id !== undefined ? String(s.id) : s.slug;
      if (key && !collected.has(key)) collected.set(key, s);
    }
  };

  for (let page = 0; page < MAX_SERIES_PAGES; page++) {
    const { data, error } = await gate.run(() =>
      getJson<unknown>(
        "/series",
        new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), closed: "false" })
      )
    );
    pagesFetched++;
    if (error) {
      errors.push(error);
      break;
    }
    const batch = extractSeriesArray(data);
    addAll(batch);
    if (batch.length < PAGE_SIZE) break;
  }

  for (const label of ["Sports", "Soccer"]) {
    const { data, error } = await gate.run(() =>
      getJson<unknown>(
        "/series",
        new URLSearchParams({ limit: String(PAGE_SIZE), closed: "false", categories_labels: label })
      )
    );
    if (error) errors.push(error);
    else addAll(extractSeriesArray(data));
  }

  return { series: [...collected.values()], errors, pagesFetched };
}

// Premier League, La Liga, and Serie A are official Polymarket partner leagues, and their
// real match-by-match events live under a series_id (gamma-api.polymarket.com/events?series_id=...)
// rather than any tag_slug we can guess — confirmed by live debug data showing these three
// leagues' tag_slug results are ENTIRELY season-long futures/props (Top Goalscorer, 2027
// Champion, promotion odds, etc.) with zero actual fixtures. This discovers each league's
// series id from the real /series endpoint instead.
async function fetchLeaguesBySeries(): Promise<{
  events: RawEvent[];
  matchedLeagues: string[];
  errors: string[];
  seriesFetched: number;
  sampleSeries: { id?: string | number; slug?: string; title?: string }[];
}> {
  const { series: allSeries, errors } = await fetchAllSeries();
  const sampleSeries = allSeries.slice(0, 40).map((s) => ({ id: s.id, slug: s.slug, title: s.title }));

  const matches: { leagueId: string; series: RawSeries }[] = [];
  for (const series of allSeries) {
    const text = `${series.title ?? ""} ${(series.slug ?? "").replace(/-/g, " ")}`;
    const league = matchLeague([text]);
    if (league && series.id !== undefined) {
      matches.push({ leagueId: league.id, series });
    }
  }

  if (matches.length === 0) {
    return { events: [], matchedLeagues: [], errors, seriesFetched: allSeries.length, sampleSeries };
  }

  const seen = new Set<string>();
  const merged: RawEvent[] = [];
  const matchedLeagues: string[] = [];

  const results = await Promise.all(
    matches.map(async (m) => {
      const result = await fetchPaginated(
        { closed: "false", active: "true", series_id: String(m.series.id) },
        MAX_LEAGUE_PAGES
      );
      return { ...m, ...result };
    })
  );

  for (const result of results) {
    errors.push(...result.errors);
    if (result.events.length > 0) {
      matchedLeagues.push(`${result.leagueId}(series_id=${result.series.id})=${result.events.length}`);
      for (const e of result.events) {
        if (e?.id && !seen.has(e.id)) {
          seen.add(e.id);
          merged.push(e);
        }
      }
    }
  }

  return { events: merged, matchedLeagues, errors, seriesFetched: allSeries.length, sampleSeries };
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
  seriesFetched: number;
  sampleSeries: { id?: string | number; slug?: string; title?: string }[];
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

  const seriesResult = await fetchLeaguesBySeries();
  errors.push(...seriesResult.errors);
  if (seriesResult.events.length > 0) {
    addAll(seriesResult.events);
    strategies.push(`series(${seriesResult.matchedLeagues.join(",")})`);
  }

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

  return {
    events: merged,
    strategy: strategies.join(" + ") || "none",
    errors,
    seriesFetched: seriesResult.seriesFetched,
    sampleSeries: seriesResult.sampleSeries,
  };
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

// Official partner leagues (Premier League, La Liga, Serie A) label their draw outcome
// with standard European "1X2" notation — a bare "X" — rather than a word containing
// "draw"/"tie" like every other league's markets do. Matching only the word form meant
// drawEntry was always undefined for these three leagues, so every one of their events
// was silently rejected here despite being correctly fetched and league-matched.
function isDrawLabel(label: string): boolean {
  if (/draw|tie/i.test(label)) return true;
  return label.trim().toLowerCase() === "x";
}

function parseEvent(event: RawEvent): Game | null {
  if (!event.markets || event.markets.length === 0) return null;
  if (DERIVATIVE_EVENT_SUFFIX.test(event.title)) return null;

  const league = matchLeague(eventLeagueFields(event));
  if (!league) return null;

  const entries = collectOutcomeEntries(event.markets);
  if (entries.length < 3) return null;

  const drawEntry = entries.find((e) => isDrawLabel(e.label));
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
  const isNumeric1X2Label = (label: string) => label.trim() === "1" || label.trim() === "2";
  if (isNumeric1X2Label(teamA.label) && isNumeric1X2Label(teamB.label)) {
    // Standard "1X2" notation carries no team name to match against the title — "1" means
    // home and "2" means away by convention, not by which one looks more like which name.
    if (teamA.label.trim() !== "1") [teamA, teamB] = [teamB, teamA];
  } else if (titleTeams) {
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

const MATCH_LIKE_TITLE = /\bvs\.?\b|\bv\.?\b|@/i;

// Premier League, La Liga, and Serie A are Polymarket's exclusive partner leagues — see
// the debug/raw sample diagnostics below, which exist specifically to root-cause why
// these three keep coming back with real events matched but zero games parsed.
const PARTNER_LEAGUE_IDS = new Set(["premier-league", "la-liga", "serie-a"]);

// Confirmed real premier-league/la-liga/serie-a tag-matched events carry an EMPTY series
// array and are entirely season-long futures/props — no real fixture-titled event was found
// among them. But that only rules out events matchLeague() already assigned to one of these
// leagues. If a real "Arsenal vs. Chelsea" fixture exists in the raw pool WITHOUT any
// league-identifying tag/series text at all (unlike every other league checked so far,
// including a minor one — Canadian Premier League — which does carry one), matchLeague()
// would silently drop it before it ever reached eventsMatchingLeague, invisible to every
// diagnostic above. This scans the FULL raw pool (not just league-matched events) for
// match-like titles naming two known top-flight clubs from these three leagues specifically,
// to rule that possibility in or out directly instead of continuing to infer from what
// league-matching already excluded.
function findUnmatchedPartnerLeagueFixtures(events: RawEvent[]): RawEvent[] {
  const clubNames = [
    ...getTopTeamNames("premier-league"),
    ...getTopTeamNames("la-liga"),
    ...getTopTeamNames("serie-a"),
  ]
    .map((n) => normalizeTeamName(n))
    .filter((n) => n.length >= 4);

  const mentionsTwoClubs = (title: string): boolean => {
    const norm = normalizeTeamName(title);
    let count = 0;
    for (const club of clubNames) {
      if (norm.includes(club)) count++;
      if (count >= 2) return true;
    }
    return false;
  };

  return events.filter(
    (e) => MATCH_LIKE_TITLE.test(e.title) && !matchLeague(eventLeagueFields(e)) && mentionsTwoClubs(e.title)
  );
}

export async function getFetchDiagnostics(): Promise<FetchDiagnostics> {
  const { events, strategy, errors, seriesFetched, sampleSeries } = await fetchSoccerEvents();
  const eventsWithMarkets = events.filter((e) => (e.markets?.length ?? 0) > 0);

  const eventsMatchingLeague = eventsWithMarkets.filter(eventMatchesTargetLeague);

  const unmatchedPartnerLeagueFixtures = findUnmatchedPartnerLeagueFixtures(eventsWithMarkets).slice(0, 10).map(
    (e) => ({
      title: e.title,
      tags: (e.tags ?? []).map((t) => `${t.label ?? ""}/${t.slug ?? ""}`),
      series: (e.series ?? []).map((s) => `${s.title ?? ""}/${s.slug ?? ""}`),
    })
  );

  const parsedGames = eventsMatchingLeague
    .map((e) => ({ event: e, game: parseEvent(e) }))
    .filter((r) => r.game !== null);

  const allParsedGames = parsedGames.map((r) => r.game as Game);
  const finalGames = allParsedGames.filter((g) => withinWindow(g.startTime));

  const rejected = eventsMatchingLeague
    .filter((e) => parseEvent(e) === null)
    .slice(0, 8)
    .map((e) => e.title);

  // The premier-league/la-liga/serie-a "0% parse rate" bug (fixed by recognizing a bare
  // "X" draw label) took several rounds to pin down because sampleRejectedTitles alone
  // couldn't show *why* an event was rejected. Surfacing the raw outcome labels for any
  // future rejection in these specific leagues means the next debug pull is conclusive.
  //
  // A first real debug pull after that fix still showed 0 games for all three leagues,
  // and every sampled rejection was a season-long futures/props market ("Top Goalscorer",
  // "2027 Champion", promotion odds, etc.) — never an actual fixture. That raised a new
  // question the old 6-item, unordered sample couldn't answer: are there ANY real
  // match-titled ("X vs. Y") events among what these leagues' tags return at all, or do
  // the tags only ever surface futures/props with no per-fixture 1X2 market underneath?
  // matchLikeRejectionCount/nonMatchLikeRejectionCount answers that directly, and
  // match-titled rejections are sorted first so real fixtures are never crowded out of
  // the sample by futures markets the way they were last time.
  const partnerLeagueRejected = eventsMatchingLeague.filter((e) => {
    const league = matchLeague(eventLeagueFields(e));
    return league && PARTNER_LEAGUE_IDS.has(league.id) && parseEvent(e) === null;
  });
  const matchLikeRejectionCount = partnerLeagueRejected.filter((e) =>
    MATCH_LIKE_TITLE.test(e.title)
  ).length;
  const samplePartnerLeagueRejections = [...partnerLeagueRejected]
    .sort((a, b) => Number(MATCH_LIKE_TITLE.test(b.title)) - Number(MATCH_LIKE_TITLE.test(a.title)))
    .slice(0, 15)
    .map((e) => ({
      title: e.title,
      league: matchLeague(eventLeagueFields(e))?.id,
      matchLikeTitle: MATCH_LIKE_TITLE.test(e.title),
      labels: collectOutcomeEntries(e.markets ?? []).map((entry) => entry.label),
    }));

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
    partnerLeagueMatchLikeRejections: matchLikeRejectionCount,
    partnerLeagueNonMatchLikeRejections: partnerLeagueRejected.length - matchLikeRejectionCount,
    samplePartnerLeagueRejections,
    sampleParsedKickoffs,
    requestErrors: errors,
    seriesFetched,
    sampleSeries,
    unmatchedPartnerLeagueFixtures,
  };
}

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
  titlesShown: number;
  titles: string[];
  matchLikeEvents: ReturnType<typeof trimEventForDebug>[];
  leagueMatchedEvents: ReturnType<typeof trimEventForDebug>[];
  partnerLeagueEvents: ReturnType<typeof trimEventForDebug>[];
}

export async function getRawSample(): Promise<RawSample> {
  const { events, strategy } = await fetchSoccerEvents();

  const matchLikeEvents = events.filter((e) => MATCH_LIKE_TITLE.test(e.title)).slice(0, 4);
  const leagueMatchedEvents = events.filter(eventMatchesTargetLeague).slice(0, 4);
  // Full title list can run into the thousands across a broad sweep — capped so this
  // endpoint's response stays practical to inspect/paste; totalFetched keeps the real count.
  const titles = events.map((e) => e.title).slice(0, 80);

  // Full untrimmed-by-count dump of every premier-league/la-liga/serie-a matched event,
  // match-like titles first — the debug endpoint's samplePartnerLeagueRejections shows
  // parsed outcome labels only, this shows the complete raw market objects (question,
  // groupItemTitle, outcomes, outcomePrices) so nothing about their real shape is guessed.
  const partnerLeagueEvents = events
    .filter((e) => {
      const league = matchLeague(eventLeagueFields(e));
      return league && PARTNER_LEAGUE_IDS.has(league.id);
    })
    .sort((a, b) => Number(MATCH_LIKE_TITLE.test(b.title)) - Number(MATCH_LIKE_TITLE.test(a.title)))
    .slice(0, 20);

  return {
    strategy,
    totalFetched: events.length,
    titlesShown: titles.length,
    titles,
    matchLikeEvents: matchLikeEvents.map(trimEventForDebug),
    leagueMatchedEvents: leagueMatchedEvents.map(trimEventForDebug),
    partnerLeagueEvents: partnerLeagueEvents.map(trimEventForDebug),
  };
}

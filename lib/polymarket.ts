import { matchLeague } from "./leagues";
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

async function getJson<T>(path: string, params: URLSearchParams): Promise<T | null> {
  try {
    const res = await fetch(`${GAMMA_BASE}${path}?${params.toString()}`, {
      next: { revalidate: 45 },
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      console.error(`Polymarket ${path} request failed: ${res.status} ${res.statusText}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`Polymarket ${path} request threw`, err);
    return null;
  }
}

function extractEventsArray(data: unknown): RawEvent[] {
  if (Array.isArray(data)) return data as RawEvent[];
  if (data && typeof data === "object" && Array.isArray((data as { events?: unknown }).events)) {
    return (data as { events: RawEvent[] }).events;
  }
  return [];
}

async function fetchEventsByParams(params: URLSearchParams): Promise<RawEvent[]> {
  const data = await getJson<unknown>("/events", params);
  return extractEventsArray(data);
}

async function discoverSoccerTagId(): Promise<string | null> {
  const data = await getJson<unknown>("/tags", new URLSearchParams({ limit: "1000" }));
  const tags = Array.isArray(data) ? (data as RawTag[]) : [];
  const match = tags.find((t) => {
    const s = `${t.slug ?? ""} ${t.label ?? ""}`.toLowerCase();
    return s.includes("soccer") || s.includes("football");
  });
  return match ? String(match.id) : null;
}

async function fetchEventsBroad(maxPages = 4, pageSize = 500): Promise<RawEvent[]> {
  const all: RawEvent[] = [];
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      closed: "false",
      active: "true",
      limit: String(pageSize),
      offset: String(page * pageSize),
      order: "start_date",
      ascending: "true",
    });
    const events = await fetchEventsByParams(params);
    if (events.length === 0) break;
    all.push(...events);
    if (events.length < pageSize) break;
  }
  return all;
}

async function fetchSoccerEvents(): Promise<{ events: RawEvent[]; strategy: string }> {
  const directAttempts: [string, URLSearchParams][] = [
    [
      "tag_slug=soccer",
      new URLSearchParams({
        closed: "false",
        active: "true",
        limit: "300",
        order: "start_date",
        ascending: "true",
        tag_slug: "soccer",
      }),
    ],
    [
      "tag_slug=football",
      new URLSearchParams({
        closed: "false",
        active: "true",
        limit: "300",
        order: "start_date",
        ascending: "true",
        tag_slug: "football",
      }),
    ],
  ];

  for (const [label, params] of directAttempts) {
    const events = await fetchEventsByParams(params);
    if (events.length > 0) return { events, strategy: label };
  }

  const tagId = await discoverSoccerTagId();
  if (tagId) {
    const events = await fetchEventsByParams(
      new URLSearchParams({
        closed: "false",
        active: "true",
        limit: "300",
        order: "start_date",
        ascending: "true",
        tag_id: tagId,
      })
    );
    if (events.length > 0) return { events, strategy: `tag_id=${tagId}` };
  }

  const broad = await fetchEventsBroad();
  return { events: broad, strategy: "broad+keyword" };
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

function parseEvent(event: RawEvent): Game | null {
  if (!event.markets || event.markets.length === 0) return null;

  const league = matchLeague([
    event.title,
    event.slug,
    ...(event.tags ?? []).map((t) => `${t.label ?? ""} ${t.slug ?? ""}`),
    ...(event.series ?? []).map((s) => `${s.title ?? ""} ${s.slug ?? ""}`),
  ]);
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
  const { events } = await fetchSoccerEvents();

  const games = events
    .map(parseEvent)
    .filter((g): g is Game => g !== null)
    .filter((g) => withinWindow(g.startTime))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return games;
}

export async function getFetchDiagnostics(): Promise<FetchDiagnostics> {
  const { events, strategy } = await fetchSoccerEvents();
  const eventsWithMarkets = events.filter((e) => (e.markets?.length ?? 0) > 0);

  const eventsMatchingLeague = eventsWithMarkets.filter((e) =>
    matchLeague([
      e.title,
      e.slug,
      ...(e.tags ?? []).map((t) => `${t.label ?? ""} ${t.slug ?? ""}`),
      ...(e.series ?? []).map((s) => `${s.title ?? ""} ${s.slug ?? ""}`),
    ])
  );

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
  };
}

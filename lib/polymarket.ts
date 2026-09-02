import { matchLeague } from "./leagues";
import type { Game } from "./types";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

interface RawMarket {
  question?: string;
  groupItemTitle?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  slug?: string;
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

async function fetchEventsPage(params: URLSearchParams): Promise<RawEvent[]> {
  const res = await fetch(`${GAMMA_BASE}/events?${params.toString()}`, {
    next: { revalidate: 45 },
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Polymarket events request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (Array.isArray(data)) return data as RawEvent[];
  if (Array.isArray(data?.events)) return data.events as RawEvent[];
  return [];
}

async function fetchSoccerEvents(): Promise<RawEvent[]> {
  const strategies: URLSearchParams[] = [
    new URLSearchParams({
      closed: "false",
      active: "true",
      limit: "300",
      order: "start_date",
      ascending: "true",
      tag_slug: "soccer",
    }),
    new URLSearchParams({
      closed: "false",
      active: "true",
      limit: "300",
      order: "start_date",
      ascending: "true",
      tag_slug: "football",
    }),
  ];

  for (const params of strategies) {
    try {
      const events = await fetchEventsPage(params);
      if (events.length > 0) return events;
    } catch (err) {
      console.error("Polymarket fetch strategy failed", err);
    }
  }
  return [];
}

function extractTeams(eventTitle: string): { home: string; away: string } | null {
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

function parseEvent(event: RawEvent): Game | null {
  if (!event.markets || event.markets.length < 3) return null;

  const league = matchLeague([
    event.title,
    event.slug,
    ...(event.tags ?? []).map((t) => `${t.label ?? ""} ${t.slug ?? ""}`),
    ...(event.series ?? []).map((s) => `${s.title ?? ""} ${s.slug ?? ""}`),
  ]);
  if (!league) return null;

  const teams = extractTeams(event.title);
  if (!teams) return null;

  let homeProb = -1;
  let drawProb = -1;
  let awayProb = -1;

  for (const market of event.markets) {
    const label = (market.groupItemTitle || market.question || "").toLowerCase();
    const outcomes = parseArrayField(market.outcomes).map((o) => o.toLowerCase());
    const prices = parseArrayField(market.outcomePrices).map((p) => parseFloat(p));
    const yesIdx = outcomes.indexOf("yes");
    const price = yesIdx >= 0 ? prices[yesIdx] : prices[0];
    if (!Number.isFinite(price)) continue;

    if (label.includes("draw") || label.includes("tie")) {
      drawProb = price;
    } else if (label.includes(teams.home.toLowerCase()) || teams.home.toLowerCase().includes(label)) {
      homeProb = price;
    } else if (label.includes(teams.away.toLowerCase()) || teams.away.toLowerCase().includes(label)) {
      awayProb = price;
    }
  }

  if (homeProb < 0 || drawProb < 0 || awayProb < 0) return null;

  const odds = normalizeProbabilities(homeProb, drawProb, awayProb);
  if (!odds) return null;

  return {
    id: event.id,
    slug: event.slug,
    league: league.id,
    leagueName: league.name,
    leagueFlag: league.flag,
    homeTeam: teams.home,
    awayTeam: teams.away,
    startTime: event.startDate || event.markets[0]?.startDate || new Date().toISOString(),
    odds,
    volume: toNumber(event.volume),
    liquidity: toNumber(event.liquidity),
    polymarketUrl: `https://polymarket.com/event/${event.slug}`,
  };
}

export async function getUpcomingGames(): Promise<Game[]> {
  const events = await fetchSoccerEvents();
  const now = Date.now();
  const horizon = now + 14 * 24 * 60 * 60 * 1000;
  const grace = now - 3 * 60 * 60 * 1000;

  const games = events
    .map(parseEvent)
    .filter((g): g is Game => g !== null)
    .filter((g) => {
      const t = new Date(g.startTime).getTime();
      return Number.isFinite(t) && t >= grace && t <= horizon;
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return games;
}

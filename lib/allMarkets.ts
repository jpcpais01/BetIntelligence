import type { Market, MarketOutcome } from "./types";

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 3; // trending-ordered, so the good stuff is always in the first page or two
const MAX_OUTCOMES_PER_MARKET = 8;
const MAX_MARKETS = 150;

interface RawMarket {
  question?: string;
  groupItemTitle?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  volume?: string | number;
  liquidity?: string | number;
}

interface RawEvent {
  id: string;
  slug: string;
  title: string;
  endDate?: string;
  volume?: string | number;
  liquidity?: string | number;
  image?: string;
  tags?: { label?: string; slug?: string }[];
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

async function fetchEvents(params: URLSearchParams): Promise<RawEvent[] | null> {
  try {
    const res = await fetch(`${GAMMA_BASE}/events?${params.toString()}`, {
      // A trending feed can tolerate a couple minutes of staleness in exchange for not
      // hammering Gamma on every page load.
      next: { revalidate: 120 },
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? (data as RawEvent[]) : [];
  } catch (err) {
    console.error("allMarkets: page fetch failed", err);
    return null;
  }
}

// Gamma has rejected an unsupported `order` value outright (HTTP 422) before, in this exact
// project's history — so `order=volume_24hr` is attempted, but a rejection falls back to an
// unordered fetch (results are still re-sorted by volume client-side afterward) rather than
// losing the page entirely.
async function fetchEventsPage(offset: number): Promise<RawEvent[]> {
  const base = { active: "true", closed: "false", limit: String(PAGE_SIZE), offset: String(offset) };

  const ordered = await fetchEvents(
    new URLSearchParams({ ...base, order: "volume_24hr", ascending: "false" })
  );
  if (ordered !== null) return ordered;

  const fallback = await fetchEvents(new URLSearchParams(base));
  return fallback ?? [];
}

// A small keyword->emoji lookup, matched loosely against whatever tag text Polymarket actually
// returns — deliberately not a hardcoded list of exact tag slugs. That approach (guessing exact
// slugs ahead of time) is exactly what caused the football leagues bug; here it only decides a
// cosmetic emoji, so a miss just falls back to a generic icon rather than losing a whole category.
const CATEGORY_EMOJI: [RegExp, string][] = [
  [/elect/i, "🗳️"],
  [/politic/i, "🏛️"],
  [/crypto|bitcoin|ethereum|solana/i, "₿"],
  [/sport|soccer|football|basketball|nfl|nba|nhl|mlb|tennis|ufc|golf/i, "⚽"],
  [/business|econom|finance|stock|market/i, "💼"],
  [/entertain|movie|film|tv|celebrity|music|culture/i, "🎬"],
  [/science|tech|ai|space/i, "🔬"],
  [/world|geopolit|war/i, "🌍"],
  [/weather|climate|hurricane/i, "🌦️"],
  [/gaming|esports/i, "🎮"],
  [/health|covid|virus/i, "🩺"],
];

function categoryFor(tags: { label?: string; slug?: string }[]): { category: string; emoji: string } {
  const label = tags.find((t) => t.label && !/^(all|featured|trending)$/i.test(t.label))?.label;
  if (!label) return { category: "Other", emoji: "🔮" };
  const hit = CATEGORY_EMOJI.find(([re]) => re.test(label));
  return { category: label, emoji: hit?.[1] ?? "🔮" };
}

// Most Polymarket events are one of two shapes: a single market natively modeling every
// outcome (a plain Yes/No question, or one multi-choice question with several native options),
// or a group of separate binary Yes/No sub-markets that each represent one named option within
// a larger event (e.g. one candidate's own "Will X win?" market). Unlike the football-specific
// parser in lib/polymarket.ts, there's no fixed "must have a draw plus two teams" shape to
// enforce here — any 2+ priced outcomes are valid.
function collectOutcomes(markets: RawMarket[]): MarketOutcome[] {
  if (markets.length === 1) {
    const labels = parseArrayField(markets[0].outcomes);
    const prices = parseArrayField(markets[0].outcomePrices).map((p) => parseFloat(p));
    if (labels.length >= 2 && prices.length === labels.length) {
      return labels
        .map((label, i) => ({ label, price: prices[i] }))
        .filter((o) => o.label && Number.isFinite(o.price));
    }
  }

  const outcomes: MarketOutcome[] = [];
  for (const m of markets) {
    const label = m.groupItemTitle || m.question || "";
    if (!label) continue;
    const optionLabels = parseArrayField(m.outcomes).map((o) => o.toLowerCase());
    const prices = parseArrayField(m.outcomePrices).map((p) => parseFloat(p));
    const yesIdx = optionLabels.indexOf("yes");
    const price = yesIdx >= 0 ? prices[yesIdx] : prices[0];
    if (Number.isFinite(price)) outcomes.push({ label, price });
  }
  return outcomes;
}

function parseEvent(event: RawEvent): Market | null {
  const markets = event.markets ?? [];
  if (markets.length === 0) return null;

  const allOutcomes = collectOutcomes(markets)
    .filter((o) => o.price >= 0 && o.price <= 1)
    .sort((a, b) => b.price - a.price);
  if (allOutcomes.length < 2) return null;

  const volume = toNumber(event.volume);
  const liquidity = toNumber(event.liquidity);
  if (volume <= 0 && liquidity <= 0) return null;

  const { category, emoji } = categoryFor(event.tags ?? []);

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    category,
    categoryEmoji: emoji,
    outcomes: allOutcomes.slice(0, MAX_OUTCOMES_PER_MARKET),
    totalOutcomes: allOutcomes.length,
    endDate: event.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    volume,
    liquidity,
    image: event.image || null,
    polymarketUrl: `https://polymarket.com/event/${event.slug}`,
  };
}

export async function getTrendingMarkets(): Promise<Market[]> {
  const pages = await Promise.all(
    Array.from({ length: MAX_PAGES }, (_, i) => fetchEventsPage(i * PAGE_SIZE))
  );

  const seen = new Set<string>();
  const markets: Market[] = [];
  for (const page of pages) {
    for (const event of page) {
      if (!event?.id || seen.has(event.id)) continue;
      seen.add(event.id);
      const market = parseEvent(event);
      if (market) markets.push(market);
    }
  }

  // Pages are already volume-ordered by the API; re-sort after merging in case pagination
  // (fetched in parallel) landed slightly out of order relative to each other.
  return markets.sort((a, b) => b.volume - a.volume).slice(0, MAX_MARKETS);
}

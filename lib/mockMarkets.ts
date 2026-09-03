import type { Market } from "./types";

function daysFromNow(d: number): string {
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();
}

const RAW: Array<Pick<Market, "title" | "category" | "categoryEmoji" | "outcomes" | "volume" | "liquidity"> & { days: number }> = [
  {
    title: "Will the Fed cut rates at the next meeting?",
    category: "Business",
    categoryEmoji: "💼",
    outcomes: [
      { label: "Yes", price: 0.71 },
      { label: "No", price: 0.29 },
    ],
    volume: 4_820_000,
    liquidity: 612_000,
    days: 12,
  },
  {
    title: "Bitcoin above $150,000 by end of year?",
    category: "Crypto",
    categoryEmoji: "₿",
    outcomes: [
      { label: "Yes", price: 0.38 },
      { label: "No", price: 0.62 },
    ],
    volume: 6_140_000,
    liquidity: 890_000,
    days: 48,
  },
  {
    title: "2026 World Cup Winner",
    category: "Sports",
    categoryEmoji: "⚽",
    outcomes: [
      { label: "Brazil", price: 0.21 },
      { label: "France", price: 0.18 },
      { label: "Argentina", price: 0.15 },
      { label: "England", price: 0.12 },
      { label: "Spain", price: 0.1 },
      { label: "Other", price: 0.24 },
    ],
    volume: 3_275_000,
    liquidity: 501_000,
    days: 210,
  },
  {
    title: "Next James Bond actor announced by 2027?",
    category: "Entertainment",
    categoryEmoji: "🎬",
    outcomes: [
      { label: "Yes", price: 0.44 },
      { label: "No", price: 0.56 },
    ],
    volume: 812_000,
    liquidity: 94_000,
    days: 300,
  },
  {
    title: "Democratic nominee for 2028 President",
    category: "Politics",
    categoryEmoji: "🏛️",
    outcomes: [
      { label: "Gavin Newsom", price: 0.19 },
      { label: "Josh Shapiro", price: 0.14 },
      { label: "Pete Buttigieg", price: 0.11 },
      { label: "AOC", price: 0.09 },
      { label: "Other", price: 0.47 },
    ],
    volume: 5_430_000,
    liquidity: 720_000,
    days: 640,
  },
  {
    title: "Will SpaceX land Starship on Mars by 2029?",
    category: "Science",
    categoryEmoji: "🔬",
    outcomes: [
      { label: "Yes", price: 0.16 },
      { label: "No", price: 0.84 },
    ],
    volume: 640_000,
    liquidity: 71_000,
    days: 900,
  },
  {
    title: "Will OpenAI release a new flagship model this quarter?",
    category: "Tech",
    categoryEmoji: "🔬",
    outcomes: [
      { label: "Yes", price: 0.83 },
      { label: "No", price: 0.17 },
    ],
    volume: 1_120_000,
    liquidity: 205_000,
    days: 30,
  },
  {
    title: "Will there be a government shutdown this month?",
    category: "Politics",
    categoryEmoji: "🏛️",
    outcomes: [
      { label: "Yes", price: 0.27 },
      { label: "No", price: 0.73 },
    ],
    volume: 2_010_000,
    liquidity: 340_000,
    days: 20,
  },
  {
    title: "Ethereum above $6,000 this month?",
    category: "Crypto",
    categoryEmoji: "₿",
    outcomes: [
      { label: "Yes", price: 0.29 },
      { label: "No", price: 0.71 },
    ],
    volume: 1_850_000,
    liquidity: 260_000,
    days: 25,
  },
  {
    title: "Will a Category 5 hurricane hit the US this season?",
    category: "Weather",
    categoryEmoji: "🌦️",
    outcomes: [
      { label: "Yes", price: 0.34 },
      { label: "No", price: 0.66 },
    ],
    volume: 430_000,
    liquidity: 58_000,
    days: 60,
  },
];

export function getMockMarkets(): Market[] {
  return RAW.map((m, i) => ({
    id: `mock-market-${i}`,
    slug: `mock-market-${i}`,
    title: m.title,
    category: m.category,
    categoryEmoji: m.categoryEmoji,
    // Fake but present, so the "Odds history" dropdown renders in mock mode too — the API
    // route's own mock branch ignores the actual value and synthesizes a trend instead.
    outcomes: [...m.outcomes]
      .map((o, j) => ({ ...o, tokenId: `mock-token-${i}-${j}` }))
      .sort((a, b) => b.price - a.price),
    totalOutcomes: m.outcomes.length,
    endDate: daysFromNow(m.days),
    volume: m.volume,
    liquidity: m.liquidity,
    image: null,
    polymarketUrl: `https://polymarket.com/event/mock-market-${i}`,
  })).sort((a, b) => b.volume - a.volume);
}

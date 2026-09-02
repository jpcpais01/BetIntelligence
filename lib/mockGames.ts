import { getLeague } from "./leagues";
import type { Game } from "./types";

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

const RAW: Array<
  Pick<Game, "homeTeam" | "awayTeam" | "odds" | "volume" | "liquidity"> & {
    league: Parameters<typeof getLeague>[0];
    hours: number;
  }
> = [
  {
    league: "premier-league",
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
    odds: { home: 0.42, draw: 0.27, away: 0.31 },
    volume: 184300,
    liquidity: 52100,
    hours: 20,
  },
  {
    league: "premier-league",
    homeTeam: "Manchester City",
    awayTeam: "Chelsea",
    odds: { home: 0.58, draw: 0.23, away: 0.19 },
    volume: 221900,
    liquidity: 61200,
    hours: 44,
  },
  {
    league: "la-liga",
    homeTeam: "Real Madrid",
    awayTeam: "Barcelona",
    odds: { home: 0.44, draw: 0.25, away: 0.31 },
    volume: 305600,
    liquidity: 88400,
    hours: 68,
  },
  {
    league: "la-liga",
    homeTeam: "Atletico Madrid",
    awayTeam: "Sevilla",
    odds: { home: 0.55, draw: 0.26, away: 0.19 },
    volume: 97200,
    liquidity: 31000,
    hours: 26,
  },
  {
    league: "bundesliga",
    homeTeam: "Bayern Munich",
    awayTeam: "Borussia Dortmund",
    odds: { home: 0.61, draw: 0.21, away: 0.18 },
    volume: 176400,
    liquidity: 45300,
    hours: 30,
  },
  {
    league: "serie-a",
    homeTeam: "Inter Milan",
    awayTeam: "Juventus",
    odds: { home: 0.4, draw: 0.29, away: 0.31 },
    volume: 152800,
    liquidity: 39900,
    hours: 15,
  },
  {
    league: "ligue-1",
    homeTeam: "Paris Saint-Germain",
    awayTeam: "Marseille",
    odds: { home: 0.66, draw: 0.19, away: 0.15 },
    volume: 143200,
    liquidity: 37600,
    hours: 52,
  },
  {
    league: "primeira-liga",
    homeTeam: "Benfica",
    awayTeam: "Porto",
    odds: { home: 0.39, draw: 0.28, away: 0.33 },
    volume: 61300,
    liquidity: 18400,
    hours: 76,
  },
  {
    league: "eredivisie",
    homeTeam: "Ajax",
    awayTeam: "PSV Eindhoven",
    odds: { home: 0.35, draw: 0.27, away: 0.38 },
    volume: 48700,
    liquidity: 14200,
    hours: 38,
  },
  {
    league: "belgian-pro-league",
    homeTeam: "Club Brugge",
    awayTeam: "Anderlecht",
    odds: { home: 0.47, draw: 0.28, away: 0.25 },
    volume: 22100,
    liquidity: 7300,
    hours: 62,
  },
  {
    league: "brasileirao",
    homeTeam: "Flamengo",
    awayTeam: "Palmeiras",
    odds: { home: 0.41, draw: 0.29, away: 0.3 },
    volume: 88900,
    liquidity: 24700,
    hours: 8,
  },
  {
    league: "brasileirao",
    homeTeam: "Sao Paulo",
    awayTeam: "Corinthians",
    odds: { home: 0.36, draw: 0.31, away: 0.33 },
    volume: 54200,
    liquidity: 16800,
    hours: 90,
  },
];

export function getMockGames(): Game[] {
  return RAW.map((g, i) => {
    const league = getLeague(g.league);
    const slug = `${g.homeTeam}-vs-${g.awayTeam}`.toLowerCase().replace(/\s+/g, "-");
    return {
      id: `mock-${i}`,
      slug,
      league: league.id,
      leagueName: league.name,
      leagueFlag: league.flag,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      startTime: hoursFromNow(g.hours),
      odds: g.odds,
      volume: g.volume,
      liquidity: g.liquidity,
      polymarketUrl: `https://polymarket.com/event/${slug}`,
    };
  }).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

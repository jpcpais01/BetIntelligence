export type LeagueId =
  | "premier-league"
  | "la-liga"
  | "serie-a"
  | "bundesliga"
  | "ligue-1"
  | "eredivisie"
  | "primeira-liga"
  | "belgian-pro-league"
  | "brasileirao";

export interface Probabilities {
  home: number;
  draw: number;
  away: number;
}

export interface Game {
  id: string;
  slug: string;
  league: LeagueId;
  leagueName: string;
  leagueFlag: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  odds: Probabilities;
  volume: number;
  liquidity: number;
  polymarketUrl: string;
}

export type Confidence = "low" | "medium" | "high";

export interface SourceCitation {
  url: string;
  title: string;
}

export interface IndependentPrediction {
  home: number;
  draw: number;
  away: number;
  confidence: Confidence;
  keyFactors: string[];
  rationale: string;
  sources?: SourceCitation[];
}

export type ValueSide = "home" | "draw" | "away" | "none";

export interface ComparisonResult {
  edges: Probabilities;
  bestValue: ValueSide;
  confidence: Confidence;
  agreesWithMarket: boolean;
  verdict: string;
}

export interface SavedPick {
  id: string;
  savedAt: string;
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  leagueFlag: string;
  startTime: string;
  market: Probabilities;
  independent: IndependentPrediction;
  comparison: ComparisonResult;
}

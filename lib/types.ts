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
  // In USD, from OpenRouter's usage accounting — the sum of every OpenRouter call this read
  // took to produce (the research call plus the predict call, and across every independent run
  // if more than one was requested). Undefined when the provider didn't return cost data.
  costUsd?: number;
}

export type ValueSide = "home" | "draw" | "away" | "none";

export interface ComparisonResult {
  edges: Probabilities;
  bestValue: ValueSide;
  confidence: Confidence;
  agreesWithMarket: boolean;
  verdict: string;
  costUsd?: number;
}

// Present only when a pick was analyzed with more than one independent research run — the
// per-run probabilities plus how much those runs agreed with each other. `runs` mirrors whatever
// outcome shape the pick itself uses (home/draw/away for football, OutcomeProbability[] for
// Discover markets) so each run's own read can still be shown alongside the merged average.
export interface ResearchSummary<TRun> {
  runCount: number;
  agreementPct: number;
  spread: number;
  runs: TRun[];
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
  research?: ResearchSummary<Probabilities>;
  // independent.costUsd + comparison.costUsd, precomputed at save time for convenient display.
  totalCostUsd?: number;
}

// Generalized versions of the above for the Discover feed — any Polymarket market, not just
// football's fixed home/draw/away shape. An outcome is keyed by its own label since a market
// can have anywhere from 2 (Yes/No) to a dozen-plus named outcomes.
export interface MarketOutcome {
  label: string;
  price: number;
}

export interface Market {
  id: string;
  slug: string;
  title: string;
  category: string;
  categoryEmoji: string;
  outcomes: MarketOutcome[]; // sorted by price, descending
  totalOutcomes: number; // outcomes.length may be truncated to the top few; this is the real count
  endDate: string;
  volume: number;
  liquidity: number;
  image: string | null;
  polymarketUrl: string;
}

export interface OutcomeProbability {
  label: string;
  probability: number;
}

export interface MarketPrediction {
  outcomes: OutcomeProbability[];
  confidence: Confidence;
  keyFactors: string[];
  rationale: string;
  sources?: SourceCitation[];
  costUsd?: number;
}

export interface OutcomeEdge {
  label: string;
  edge: number;
}

export interface MarketComparison {
  edges: OutcomeEdge[];
  bestValue: string | null; // an outcome label, or null for "no meaningful edge"
  confidence: Confidence;
  agreesWithMarket: boolean;
  verdict: string;
  costUsd?: number;
}

export interface SavedMarketPick {
  id: string;
  savedAt: string;
  title: string;
  category: string;
  categoryEmoji: string;
  endDate: string;
  market: MarketOutcome[];
  independent: MarketPrediction;
  comparison: MarketComparison;
  polymarketUrl: string;
  research?: ResearchSummary<OutcomeProbability[]>;
  totalCostUsd?: number;
}

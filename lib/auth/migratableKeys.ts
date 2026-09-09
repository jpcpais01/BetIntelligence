// The known localStorage keys worth carrying into a new account — genuine user data and
// preferences, never a pure cache (Polymarket's games/markets lists, the club-logo cache) that's
// cheaply refetched and isn't really "theirs" to migrate. Deliberately its own file with zero
// imports: lib/auth/migrate.ts (server-only, pulls in firebase-admin) and
// lib/auth/localSnapshot.ts (client-only, reads window.localStorage) both need this same map, and
// neither may import the other's module — a shared, dependency-free constants file is what keeps
// firebase-admin (a Node-only package) from ever being pulled into the client bundle.
export const MIGRATABLE_KEYS = {
  lastAnalysis: "betintelligence.lastAnalysis.v1",
  lastMarketAnalysis: "betintelligence.lastMarketAnalysis.v1",
  picks: "betintelligence.picks.v1",
  marketPicks: "betintelligence.marketPicks.v1",
  placedBets: "betintelligence.placedBets.v1",
  portfolioDeposits: "betintelligence.portfolio.deposits.v1",
  slip: "betintelligence.slip.v2",
  celebratedBets: "betintelligence.celebratedBets.v1",
  leaguePrefs: "betintelligence.leagues.v1",
  model: "betintelligence.model.v1",
  researchRuns: "betintelligence.researchRuns.v1",
} as const;

export type MigratableKey = keyof typeof MIGRATABLE_KEYS;

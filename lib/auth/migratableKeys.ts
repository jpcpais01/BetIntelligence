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

// Which keys hold MANY individually-sized records rather than one small blob. These get split
// into one Firestore document per record — keyed by the record's own map key (lastAnalysis/
// lastMarketAnalysis are Record<id, entry>) or its own `.id` field (picks/marketPicks/placedBets
// are arrays of objects that already carry one) — rather than written as a single document. A
// real, sizeable history of any of these can otherwise exceed Firestore's 1MiB-per-document cap
// in one blob: exactly the bug that made a real signup (with real history to import, unlike this
// file's own tiny test fixtures) report a scary "could not create your account" error even though
// the account itself had already been created successfully by that point in the request. See
// lib/auth/migrate.ts for the write side and app/api/account/last-analysis/route.ts for the read
// side this same per-record shape makes possible.
export const MAP_SHAPED_KEYS: readonly MigratableKey[] = ["lastAnalysis", "lastMarketAnalysis"];
export const ARRAY_SHAPED_KEYS: readonly MigratableKey[] = ["picks", "marketPicks", "placedBets"];

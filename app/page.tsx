"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Game, LeagueId } from "@/lib/types";
import GameCard from "@/components/GameCard";
import GameCardSkeleton from "@/components/GameCardSkeleton";
import LeagueFilter from "@/components/LeagueFilter";
import AnalysisSheet from "@/components/AnalysisSheet";
import { AlertIcon, RefreshIcon, SparkleIcon } from "@/components/icons";
import { isTopGame } from "@/lib/topTeams";
import { formatRelativeTime } from "@/lib/format";
import {
  loadCachedGames,
  saveCachedGames,
  isStale,
  REFRESH_INTERVAL_MS,
} from "@/lib/gamesCache";
import { loadSelectedLeagues, saveSelectedLeagues } from "@/lib/leaguePrefs";

export default function Home() {
  const [games, setGames] = useState<Game[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedLeagues, setSelectedLeagues] = useState<LeagueId[]>([]);
  const [topOnly, setTopOnly] = useState(false);
  const [analyzeGame, setAnalyzeGame] = useState<Game | null>(null);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/games", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load games.");
      const now = new Date().toISOString();
      setGames(data.games);
      setFetchedAt(now);
      setError(null);
      saveCachedGames(data.games, now);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load games.");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Show cached markets instantly on load, then revalidate in the background if they've aged out.
  useEffect(() => {
    const cached = loadCachedGames();
    if (cached) {
      /* eslint-disable react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR */
      setGames(cached.games);
      setFetchedAt(cached.fetchedAt);
    }
    setSelectedLeagues(loadSelectedLeagues());
    /* eslint-enable react-hooks/set-state-in-effect */
    if (!cached || isStale(cached.fetchedAt)) {
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Coming back to a tab that's been sitting open shouldn't show half-hour-old odds.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && isStale(fetchedAt)) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [fetchedAt, refresh]);

  const toggleLeague = useCallback((id: LeagueId) => {
    setSelectedLeagues((current) => {
      const next = current.includes(id) ? current.filter((l) => l !== id) : [...current, id];
      saveSelectedLeagues(next);
      return next;
    });
  }, []);

  const clearLeagues = useCallback(() => {
    setSelectedLeagues([]);
    saveSelectedLeagues([]);
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: games?.length ?? 0 };
    for (const g of games ?? []) c[g.league] = (c[g.league] ?? 0) + 1;
    return c;
  }, [games]);

  const byLeague = useMemo(() => {
    if (!games) return [];
    if (selectedLeagues.length === 0) return games;
    return games.filter((g) => selectedLeagues.includes(g.league));
  }, [games, selectedLeagues]);

  const topCount = useMemo(() => byLeague.filter(isTopGame).length, [byLeague]);

  const filtered = useMemo(
    () => (topOnly ? byLeague.filter(isTopGame) : byLeague),
    [byLeague, topOnly]
  );

  const showFullError = error !== null && games === null;

  return (
    <div className="mx-auto max-w-md">
      <header className="safe-top sticky top-0 z-30 border-b border-border-soft bg-bg/85 px-4 pb-3 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[17px] font-bold tracking-tight">
              Bet<span className="text-accent">Intelligence</span>
            </h1>
            <p className="text-[11px] text-text-faint">
              {isRefreshing ? "Updating odds..." : `Updated ${formatRelativeTime(fetchedAt)}`}
            </p>
          </div>
          <button
            onClick={() => void refresh()}
            disabled={isRefreshing}
            aria-label="Refresh odds"
            className="press shrink-0 rounded-full bg-surface p-2.5 text-text-dim ring-1 ring-inset ring-border-soft disabled:opacity-50"
          >
            <RefreshIcon className={`h-4 w-4 ${isRefreshing ? "spin" : ""}`} />
          </button>
        </div>

        <div className="mt-3">
          <LeagueFilter
            selected={selectedLeagues}
            onToggle={toggleLeague}
            onClear={clearLeagues}
            counts={counts}
            topOnly={topOnly}
            onToggleTop={() => setTopOnly((v) => !v)}
            topCount={topCount}
          />
        </div>
      </header>

      <div className="px-4 pt-4">
        {error && games !== null && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-accent-3/8 px-3 py-2 ring-1 ring-inset ring-accent-3/20">
            <AlertIcon className="h-3.5 w-3.5 shrink-0 text-accent-3" />
            <p className="text-[11px] text-text-dim">
              Couldn&apos;t refresh &mdash; showing odds from {formatRelativeTime(fetchedAt)}.
            </p>
          </div>
        )}

        {showFullError && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border-soft bg-surface px-5 py-12 text-center">
            <AlertIcon className="h-6 w-6 text-accent-3" />
            <p className="selectable text-[13px] text-text-dim">{error}</p>
            <button
              onClick={() => void refresh()}
              className="press mt-1 rounded-full bg-accent/12 px-4 py-2 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/25"
            >
              Try again
            </button>
          </div>
        )}

        {!showFullError && games === null && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <GameCardSkeleton key={i} />
            ))}
          </div>
        )}

        {!showFullError && games !== null && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-border-soft bg-surface px-5 py-14 text-center">
            <SparkleIcon className="h-6 w-6 text-text-faint" />
            <p className="max-w-[240px] text-[13px] text-text-dim">
              {topOnly
                ? "No top-team matches in this selection right now."
                : "No upcoming matches for the selected leagues right now."}
            </p>
          </div>
        )}

        {!showFullError && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((game, i) => (
              <GameCard
                key={game.id}
                game={game}
                onAnalyze={setAnalyzeGame}
                style={{ animationDelay: `${Math.min(i, 6) * 35}ms` }}
              />
            ))}
          </div>
        )}
      </div>

      {analyzeGame && <AnalysisSheet game={analyzeGame} onClose={() => setAnalyzeGame(null)} />}
    </div>
  );
}

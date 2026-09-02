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
    <div className="mx-auto max-w-md px-4 pt-6">
      <header className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-xl font-bold tracking-tight">
            Bet<span className="text-accent">Intelligence</span>
          </h1>
          <button
            onClick={() => void refresh()}
            disabled={isRefreshing}
            aria-label="Refresh odds"
            className="shrink-0 rounded-full border border-border-soft bg-surface p-2 text-text-dim transition-colors hover:text-text disabled:opacity-50"
          >
            <RefreshIcon className={`h-4 w-4 ${isRefreshing ? "sparkle-spin" : ""}`} />
          </button>
        </div>
        <p className="text-xs text-text-faint">
          Polymarket football &middot;{" "}
          {isRefreshing ? "updating..." : `updated ${formatRelativeTime(fetchedAt)}`}
        </p>
      </header>

      {error && games !== null && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-accent-3/30 bg-accent-3/10 px-3 py-2">
          <AlertIcon className="h-4 w-4 shrink-0 text-accent-3" />
          <p className="text-[11px] text-text-dim">
            Couldn&apos;t refresh &mdash; showing saved odds from {formatRelativeTime(fetchedAt)}.
          </p>
        </div>
      )}

      <div className="mb-5">
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

      {showFullError && (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-border-soft bg-surface/70 px-5 py-12 text-center">
          <AlertIcon className="h-7 w-7 text-accent-3" />
          <p className="text-sm text-text-dim">{error}</p>
          <button
            onClick={() => void refresh()}
            className="mt-1 rounded-full bg-surface-2 px-4 py-2 text-xs font-semibold text-text"
          >
            Try again
          </button>
        </div>
      )}

      {!showFullError && games === null && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <GameCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!showFullError && games !== null && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-border-soft bg-surface/70 px-5 py-14 text-center">
          <SparkleIcon className="h-7 w-7 text-text-faint" />
          <p className="text-sm text-text-dim">
            {topOnly
              ? "No top-team matches in this selection right now."
              : "No upcoming matches for the selected leagues right now."}
          </p>
        </div>
      )}

      {!showFullError && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((game, i) => (
            <GameCard
              key={game.id}
              game={game}
              onAnalyze={setAnalyzeGame}
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            />
          ))}
        </div>
      )}

      {analyzeGame && <AnalysisSheet game={analyzeGame} onClose={() => setAnalyzeGame(null)} />}
    </div>
  );
}

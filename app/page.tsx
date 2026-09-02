"use client";

import { useEffect, useMemo, useState } from "react";
import type { Game, LeagueId } from "@/lib/types";
import GameCard from "@/components/GameCard";
import GameCardSkeleton from "@/components/GameCardSkeleton";
import LeagueFilter from "@/components/LeagueFilter";
import AnalysisSheet from "@/components/AnalysisSheet";
import { AlertIcon, SparkleIcon } from "@/components/icons";
import { isTopGame } from "@/lib/topTeams";

export default function Home() {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLeague, setSelectedLeague] = useState<LeagueId | "all">("all");
  const [topOnly, setTopOnly] = useState(false);
  const [analyzeGame, setAnalyzeGame] = useState<Game | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/games")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load games.");
        if (!cancelled) setGames(data.games);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load games.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: games?.length ?? 0 };
    for (const g of games ?? []) c[g.league] = (c[g.league] ?? 0) + 1;
    return c;
  }, [games]);

  const byLeague = useMemo(() => {
    if (!games) return [];
    return selectedLeague === "all" ? games : games.filter((g) => g.league === selectedLeague);
  }, [games, selectedLeague]);

  const topCount = useMemo(() => byLeague.filter(isTopGame).length, [byLeague]);

  const filtered = useMemo(() => {
    return topOnly ? byLeague.filter(isTopGame) : byLeague;
  }, [byLeague, topOnly]);

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">
            Bet<span className="text-accent">Intelligence</span>
          </h1>
          <p className="text-xs text-text-faint">AI odds intelligence &middot; Polymarket football</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-border-soft bg-surface px-2.5 py-1.5 text-[10px] font-semibold text-text-dim">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
          DeepSeek V4
        </div>
      </header>

      <div className="mb-5">
        <LeagueFilter
          selected={selectedLeague}
          onSelect={setSelectedLeague}
          counts={counts}
          topOnly={topOnly}
          onToggleTop={() => setTopOnly((v) => !v)}
          topCount={topCount}
        />
      </div>

      {error && (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-border-soft bg-surface/70 px-5 py-12 text-center">
          <AlertIcon className="h-7 w-7 text-accent-3" />
          <p className="text-sm text-text-dim">{error}</p>
        </div>
      )}

      {!error && games === null && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <GameCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!error && games !== null && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-border-soft bg-surface/70 px-5 py-14 text-center">
          <SparkleIcon className="h-7 w-7 text-text-faint" />
          <p className="text-sm text-text-dim">
            {topOnly
              ? "No top-team matches found for this filter right now."
              : "No upcoming matches found for this league right now."}
          </p>
        </div>
      )}

      {!error && filtered.length > 0 && (
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

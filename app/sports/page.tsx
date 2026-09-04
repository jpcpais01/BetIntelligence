"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Game, LeagueId, Probabilities } from "@/lib/types";
import GameCard from "@/components/GameCard";
import GameCardSkeleton from "@/components/GameCardSkeleton";
import LeagueFilter from "@/components/LeagueFilter";
import AnalysisSheet from "@/components/AnalysisSheet";
import BatchAnalysisSheet from "@/components/BatchAnalysisSheet";
import ModelPicker from "@/components/ModelPicker";
import { AlertIcon, RefreshIcon, SparkleIcon, ListCheckIcon, CloseIcon } from "@/components/icons";
import { isTopGame } from "@/lib/topTeams";
import { useRequestLogos } from "@/components/ClubLogosProvider";
import { formatRelativeTime } from "@/lib/format";
import {
  loadCachedGames,
  saveCachedGames,
  isStale,
  REFRESH_INTERVAL_MS,
} from "@/lib/gamesCache";
import { loadSelectedLeagues, saveSelectedLeagues } from "@/lib/leaguePrefs";
import { loadLastAnalyses, type LastAnalysisEntry } from "@/lib/lastAnalysis";
import type { LiveScoreEntry } from "@/lib/footballData";
import { teamNamesMatch } from "@/lib/teamNameMatching";

// Polling cadence for live scores — much faster than the 30-minute odds refresh, since a score is
// only useful if it's actually current.
const LIVE_SCORE_POLL_MS = 40_000;
// A game is worth polling for once its kickoff is close enough that it could plausibly be live —
// from 15 minutes before kickoff (so a match going live mid-session gets picked up promptly,
// without waiting on a manual refresh) through 6 hours after (long enough to keep showing a
// finished match's final score for a while).
function isLiveCandidate(startTime: string): boolean {
  const t = new Date(startTime).getTime();
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t <= now + 15 * 60_000 && t >= now - 6 * 3_600_000;
}

// Odds move fast once a match is actually underway — this polls much more tightly than the
// 30-minute full refresh, but only for games that have already kicked off (there's no "live"
// odds to chase before then, the normal refresh cadence is plenty).
const LIVE_ODDS_POLL_MS = 5_000;
// Bounded fallback for a league live-scores doesn't cover: without a real status to say the match
// has finished, this stops polling a few hours after kickoff rather than forever.
const LIVE_ODDS_FALLBACK_WINDOW_MS = 3 * 3_600_000;

// Games worth polling for live odds: kickoff has passed, and it isn't confirmed finished. A
// covered league's real status (from liveScoreByGameId) settles that precisely; a league
// live-scores doesn't cover falls back to a bounded "recently started" window instead of polling
// forever with no way to know the match ended.
function computeLiveOddsGameRefs(
  games: Game[],
  liveScoreByGameId: Record<string, LiveScoreEntry>
): { id: string; league: LeagueId }[] {
  const now = Date.now();
  return games
    .filter((g) => {
      const kickoff = new Date(g.startTime).getTime();
      if (!Number.isFinite(kickoff) || kickoff > now) return false;
      const score = liveScoreByGameId[g.id];
      if (score) return score.status !== "FINISHED";
      return now - kickoff <= LIVE_ODDS_FALLBACK_WINDOW_MS;
    })
    .map((g) => ({ id: g.id, league: g.league }));
}

export default function Home() {
  const [games, setGames] = useState<Game[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedLeagues, setSelectedLeagues] = useState<LeagueId[]>([]);
  const [topOnly, setTopOnly] = useState(false);
  const [analyzeGame, setAnalyzeGame] = useState<Game | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchGames, setBatchGames] = useState<Game[] | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [lastAnalysisMap, setLastAnalysisMap] = useState<Record<string, LastAnalysisEntry>>({});
  const [liveScores, setLiveScores] = useState<LiveScoreEntry[]>([]);
  const [liveOdds, setLiveOdds] = useState<Record<string, Probabilities>>({});

  const MAX_BATCH = 10;
  const requestLogos = useRequestLogos();

  // Re-read whenever an analysis sheet closes — analyses are cached automatically as soon as
  // they finish (lib/lastAnalysis.ts), whether or not the user tapped Save, so this is how a
  // card picks up "what the AI last said" right after you close the sheet.
  const refreshLastAnalysis = useCallback(() => setLastAnalysisMap(loadLastAnalyses()), []);

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
    setLastAnalysisMap(loadLastAnalyses());
    /* eslint-enable react-hooks/set-state-in-effect */
    if (!cached || isStale(cached.fetchedAt)) {
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Only poll for live scores for leagues that actually have a plausibly-live game on screen —
  // checking every covered league on every poll regardless of what's showing was most of
  // football-data.org's entire 10-requests/minute budget by itself, starving real match analysis.
  const liveCandidateLeagues = useMemo(
    () => [...new Set((games ?? []).filter((g) => isLiveCandidate(g.startTime)).map((g) => g.league))],
    [games]
  );

  useEffect(() => {
    if (liveCandidateLeagues.length === 0) return;

    let cancelled = false;
    const refreshLiveScores = async () => {
      try {
        const res = await fetch("/api/games/live-scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leagues: liveCandidateLeagues }),
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.liveScores)) setLiveScores(data.liveScores);
      } catch {
        // Best-effort enrichment — cards just keep whatever live score they last had (or none).
      }
    };

    void refreshLiveScores();
    const id = setInterval(() => void refreshLiveScores(), LIVE_SCORE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [liveCandidateLeagues]);

  const liveScoreByGameId = useMemo(() => {
    const map: Record<string, LiveScoreEntry> = {};
    for (const g of games ?? []) {
      const match = liveScores.find(
        (s) => s.league === g.league && teamNamesMatch(s.homeTeam, g.homeTeam) && teamNamesMatch(s.awayTeam, g.awayTeam)
      );
      if (match) map[g.id] = match;
    }
    return map;
  }, [games, liveScores]);

  const liveOddsGameRefs = useMemo(
    () => computeLiveOddsGameRefs(games ?? [], liveScoreByGameId),
    [games, liveScoreByGameId]
  );

  useEffect(() => {
    if (liveOddsGameRefs.length === 0) return;

    let cancelled = false;
    const refreshLiveOdds = async () => {
      try {
        const res = await fetch("/api/games/live-odds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ games: liveOddsGameRefs }),
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && data.odds && typeof data.odds === "object") {
          setLiveOdds((current) => ({ ...current, ...data.odds }));
        }
      } catch {
        // Best-effort enrichment — cards just keep showing whatever odds they already had.
      }
    };

    void refreshLiveOdds();
    const id = setInterval(() => void refreshLiveOdds(), LIVE_ODDS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [liveOddsGameRefs]);

  // Every team currently listed gets its crest requested — not just a curated "top club" list —
  // so the whole league, not a handful of elite names, shows real logos.
  useEffect(() => {
    if (!games || games.length === 0) return;
    const names = games.flatMap((g) => [g.homeTeam, g.awayTeam]);
    requestLogos(names);
  }, [games, requestLogos]);

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

  const toggleSelectMode = useCallback(() => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
    setSelectionNotice(null);
  }, []);

  const toggleGameSelected = useCallback((game: Game) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(game.id)) {
        next.delete(game.id);
        setSelectionNotice(null);
      } else {
        if (next.size >= MAX_BATCH) {
          setSelectionNotice(`You can analyze up to ${MAX_BATCH} games at once.`);
          return current;
        }
        next.add(game.id);
        setSelectionNotice(null);
      }
      return next;
    });
  }, []);

  const startBatchAnalysis = useCallback(() => {
    if (!games || selectedIds.size === 0) return;
    setBatchGames(games.filter((g) => selectedIds.has(g.id)));
    setSelectMode(false);
    setSelectedIds(new Set());
  }, [games, selectedIds]);

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
          <div className="flex shrink-0 items-center gap-2">
            <ModelPicker />
            <button
              onClick={toggleSelectMode}
              aria-label={selectMode ? "Cancel selection" : "Select games to analyze"}
              className={`press rounded-full p-2.5 ring-1 ring-inset ${
                selectMode
                  ? "bg-accent/12 text-accent ring-accent/25"
                  : "bg-surface text-text-dim ring-border-soft"
              }`}
            >
              {selectMode ? <CloseIcon className="h-4 w-4" /> : <ListCheckIcon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => void refresh()}
              disabled={isRefreshing}
              aria-label="Refresh odds"
              className="press rounded-full bg-surface p-2.5 text-text-dim ring-1 ring-inset ring-border-soft disabled:opacity-50"
            >
              <RefreshIcon className={`h-4 w-4 ${isRefreshing ? "spin" : ""}`} />
            </button>
          </div>
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
                selectMode={selectMode}
                selected={selectedIds.has(game.id)}
                onToggleSelect={toggleGameSelected}
                lastAnalysis={lastAnalysisMap[game.id] ?? null}
                liveScore={liveScoreByGameId[game.id] ?? null}
                liveOdds={liveOdds[game.id] ?? null}
              />
            ))}
          </div>
        )}
      </div>

      {selectMode && (
        <div className="fixed inset-x-0 bottom-[68px] z-30 px-4 pb-2">
          <div className="mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-border-soft bg-bg-elevated/95 px-4 py-3 shadow-lg backdrop-blur-xl">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text">
                {selectedIds.size} of {MAX_BATCH} selected
              </p>
              {selectionNotice && <p className="text-[11px] text-accent-3">{selectionNotice}</p>}
            </div>
            <button
              onClick={startBatchAnalysis}
              disabled={selectedIds.size === 0}
              className="press inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-bg disabled:opacity-40"
            >
              <SparkleIcon className="h-3.5 w-3.5" />
              Analyze {selectedIds.size > 0 ? selectedIds.size : ""}
            </button>
          </div>
        </div>
      )}

      {analyzeGame && (
        <AnalysisSheet
          game={analyzeGame}
          onClose={() => {
            setAnalyzeGame(null);
            refreshLastAnalysis();
          }}
        />
      )}
      {batchGames && (
        <BatchAnalysisSheet
          games={batchGames}
          onClose={() => {
            setBatchGames(null);
            refreshLastAnalysis();
          }}
        />
      )}
    </div>
  );
}

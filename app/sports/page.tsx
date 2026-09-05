"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { loadCachedGames, saveCachedGames, isStale, mergeGames } from "@/lib/gamesCache";
import { hasKickedOff, isLiveCandidate, isMatchOver } from "@/lib/matchClock";
import { loadSelectedLeagues, saveSelectedLeagues } from "@/lib/leaguePrefs";
import { loadLastAnalyses, type LastAnalysisEntry } from "@/lib/lastAnalysis";
import type { LiveScoreEntry } from "@/lib/liveScores";
import { anyTeamNameMatches } from "@/lib/teamNameMatching";
import { liveKey, fetchLivePrices, type LivePriceRequest } from "@/lib/livePrices";

// Live scores now come from ESPN's public site API (lib/liveScores.ts), with no comparable rate
// limit to football-data.org's — so this polls tightly enough to feel genuinely live (comfortably
// under the "at least once a minute" bar) rather than being paced to protect a shared budget.
const LIVE_SCORE_POLL_MS = 20_000;
// Odds move fast once a match is underway; Polymarket has no comparable rate limit either, but
// there's no reason to poll faster than the market itself meaningfully updates.
const LIVE_ODDS_POLL_MS = 10_000;
// How often the page re-asks "where is each match up to now?". Kickoff and full time are moments
// that pass on their own, with no data arriving to announce them, so the clock has to advance by
// itself or a match would only appear/disappear when some unrelated fetch happened to land. This
// bounds how long a match can linger once it's over, or wait to start being polled once it starts.
const CLOCK_TICK_MS = 30_000;

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
  // Every match result seen so far this session, merged and never dropped — see the poll below.
  const [scoresByMatch, setScoresByMatch] = useState<Record<string, LiveScoreEntry>>({});
  // The market's actual current price, straight from CLOB's own 5-minute-fidelity 3-hour series
  // (lib/livePrices.ts) — the exact same source and window the odds-history chart's own last
  // plotted point comes from, so a card's bars can never disagree with its own chart underneath.
  // `game.odds` (from Polymarket's Gamma events feed, refreshed at most every 10 minutes) is only
  // ever the seed/fallback here, not the displayed number, for any game whose token has traded
  // recently enough for CLOB to have an opinion.
  const [liveOdds, setLiveOdds] = useState<Record<string, Probabilities>>({});
  // Read in an effect and advanced on a timer, never called during render: Date.now() is impure,
  // so a memo that called it directly would silently disagree with itself between re-renders.
  const [now, setNow] = useState<number | null>(null);

  const MAX_BATCH = 10;
  const requestLogos = useRequestLogos();

  // Read by `refresh` below instead of depending on the `fetchedAt`/`liveGames` state directly —
  // `refresh` is a stable useCallback (empty deps), so it needs a ref to see the CURRENT value at
  // call time rather than whatever was current when it was first created.
  const fetchedAtRef = useRef<string | null>(null);
  const liveGameIdsRef = useRef<Set<string>>(new Set());
  // Mirrors `games` for the 10-second live-price poll below, so that poll can look up each live
  // game's tokenIds/fallback odds without depending on the `games` array itself — depending on it
  // directly would tear down and restart the poll's interval on every incoming score or odds
  // update, the same "never runs at its own cadence" bug this file has already hit twice before.
  const gamesRef = useRef<Game[] | null>(null);

  // Re-read whenever an analysis sheet closes — analyses are cached automatically as soon as
  // they finish (lib/lastAnalysis.ts), whether or not the user tapped Save, so this is how a
  // card picks up "what the AI last said" right after you close the sheet.
  const refreshLastAnalysis = useCallback(() => setLastAnalysisMap(loadLastAnalyses()), []);

  // The general odds sweep is click-triggered (plus the initial load, and returning to a
  // long-stale tab), never an automatic timer — but throttled so it's never asked to repeat itself
  // inside ODDS_REFRESH_MIN_INTERVAL_MS (10 minutes), on the theory that non-live odds simply don't
  // move fast enough to need it. `force` skips the throttle for explicit error recovery ("Try
  // again"), so one failed fetch doesn't lock the user out for the rest of that window.
  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    if (!opts?.force && fetchedAtRef.current && !isStale(fetchedAtRef.current)) return;
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/games", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load games.");
      const now = new Date().toISOString();
      setGames((current) => {
        const merged = mergeGames(current ?? [], data.games, liveGameIdsRef.current);
        saveCachedGames(merged, now);
        return merged;
      });
      fetchedAtRef.current = now;
      setFetchedAt(now);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load games.");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Show cached markets instantly on load, then revalidate in the background — `refresh` itself
  // decides whether that's actually necessary (nothing cached at all always fetches; a fresh cache
  // just no-ops).
  useEffect(() => {
    const cached = loadCachedGames();
    /* eslint-disable react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR */
    if (cached) {
      setGames(cached.games);
      setFetchedAt(cached.fetchedAt);
      fetchedAtRef.current = cached.fetchedAt;
    }
    setSelectedLeagues(loadSelectedLeagues());
    setLastAnalysisMap(loadLastAnalyses());
    /* eslint-enable react-hooks/set-state-in-effect */
    void refresh();
  }, [refresh]);

  useEffect(() => {
    gamesRef.current = games;
  }, [games]);

  // Seeds/refreshes every listed game's odds bars from CLOB's real current price the moment the
  // games list itself changes (initial load, a manual refresh, or a live game rejoining after
  // being merged back in) — not on its own timer, since that's exactly the cadence the general
  // sweep already respects (see ODDS_REFRESH_MIN_INTERVAL_MS). A game whose token hasn't traded
  // recently enough for CLOB to have an opinion keeps showing its own `game.odds` unchanged
  // (fetchLivePrices seeds that as the fallback for every request).
  useEffect(() => {
    if (!games || games.length === 0) return;
    const requests: LivePriceRequest[] = [];
    for (const g of games) {
      requests.push({ key: liveKey(g.id, "home"), tokenId: g.tokenIds?.home, fallback: g.odds.home });
      requests.push({ key: liveKey(g.id, "draw"), tokenId: g.tokenIds?.draw, fallback: g.odds.draw });
      requests.push({ key: liveKey(g.id, "away"), tokenId: g.tokenIds?.away, fallback: g.odds.away });
    }
    let cancelled = false;
    fetchLivePrices(requests).then((result) => {
      if (cancelled) return;
      setLiveOdds((current) => {
        const next = { ...current };
        for (const g of games) {
          next[g.id] = {
            home: result[liveKey(g.id, "home")],
            draw: result[liveKey(g.id, "draw")],
            away: result[liveKey(g.id, "away")],
          };
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [games]);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- the wall clock isn't available during SSR */
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Which game each known result belongs to. football-data.org names a match by its own club
  // names, so this is where those get matched back to Polymarket's naming — against both the full
  // and short forms, since for several clubs only the short one is recognisable.
  const scoreByGameId = useMemo(() => {
    const entries = Object.values(scoresByMatch);
    const map: Record<string, LiveScoreEntry> = {};
    for (const g of games ?? []) {
      const match = entries.find(
        (s) =>
          s.league === g.league &&
          anyTeamNameMatches([s.homeTeam, s.homeTeamShort], g.homeTeam) &&
          anyTeamNameMatches([s.awayTeam, s.awayTeamShort], g.awayTeam)
      );
      if (match) map[g.id] = match;
    }
    return map;
  }, [games, scoresByMatch]);

  // A match that's over is done being a market — it drops off the list entirely rather than
  // lingering with odds nobody can act on. Its real FINISHED status decides that where the
  // provider covers the league; the kickoff clock is the backstop everywhere else.
  const liveGames = useMemo(() => {
    if (!games) return [];
    // Before the clock has been read (the very first render), show everything rather than nothing:
    // briefly listing a match that's already over is a far smaller glitch than blanking the list.
    if (now === null) return games;
    return games.filter((g) => !isMatchOver(g.startTime, scoreByGameId[g.id]?.status, now));
  }, [games, scoreByGameId, now]);

  // Only ask about leagues that actually have a game in play right now: checking every covered
  // league on every poll was most of football-data.org's whole request budget by itself. Both
  // poll effects key off a joined STRING rather than a freshly-built array so they re-subscribe
  // only when the set genuinely changes — depending on the array meant every incoming score tore
  // down and restarted both intervals, so neither ever ran at its own stated cadence.
  const scoreLeaguesKey = useMemo(() => {
    if (now === null) return "";
    const leagues = new Set<LeagueId>();
    for (const g of liveGames) {
      if (isLiveCandidate(g.startTime, scoreByGameId[g.id]?.status, now)) leagues.add(g.league);
    }
    return [...leagues].sort().join(",");
  }, [liveGames, scoreByGameId, now]);

  useEffect(() => {
    if (!scoreLeaguesKey) return;
    const leagues = scoreLeaguesKey.split(",");

    let cancelled = false;
    const refreshLiveScores = async () => {
      try {
        const res = await fetch("/api/games/live-scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leagues }),
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data.liveScores)) return;
        // Merged in, never replacing what's already known. Each poll only covers the leagues
        // currently in play, so replacing wholesale wiped every result for a league that had just
        // stopped being polled — which is exactly how a finished match's "FT 2-1" flipped back to
        // showing its kickoff time, and how a match already known to be over could reappear.
        setScoresByMatch((current) => {
          const next = { ...current };
          for (const entry of data.liveScores as LiveScoreEntry[]) {
            next[`${entry.league}:${entry.homeTeam}:${entry.awayTeam}`] = entry;
          }
          return next;
        });
      } catch {
        // Best-effort enrichment — cards just keep whatever result they already had.
      }
    };

    void refreshLiveScores();
    const id = setInterval(() => void refreshLiveScores(), LIVE_SCORE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scoreLeaguesKey]);

  // Games worth chasing live odds for: on the list (so never one that's already over) and
  // actually underway. Encoded as a string for the same re-subscribe reason as above.
  const liveOddsKey = useMemo(() => {
    if (now === null) return "";
    return liveGames
      .filter((g) => hasKickedOff(g.startTime, now))
      .map((g) => `${g.id}:${g.league}`)
      .sort()
      .join(",");
  }, [liveGames, now]);

  // Mirrors exactly the same "kicked off, not over" set liveOddsKey encodes — read by `refresh`
  // above via the ref so a general odds sweep never overwrites what the live-odds poll owns.
  useEffect(() => {
    liveGameIdsRef.current = liveOddsKey
      ? new Set(liveOddsKey.split(",").map((entry) => entry.slice(0, entry.lastIndexOf(":"))))
      : new Set();
  }, [liveOddsKey]);

  // Re-reads CLOB's current price for whichever games are actually live, every LIVE_ODDS_POLL_MS —
  // the same source as the one-shot effect above, just refreshed far more often for the games that
  // are actually moving right now. Reads gamesRef rather than depending on `games` directly so this
  // interval isn't torn down and restarted by every incoming score/price update — only a genuine
  // change to WHICH games are live (liveOddsKey) does that.
  useEffect(() => {
    if (!liveOddsKey) return;
    const ids = liveOddsKey.split(",").map((entry) => entry.slice(0, entry.lastIndexOf(":")));

    let cancelled = false;
    const refreshLiveOdds = async () => {
      const currentGames = gamesRef.current ?? [];
      const requests: LivePriceRequest[] = [];
      for (const id of ids) {
        const g = currentGames.find((game) => game.id === id);
        if (!g) continue;
        requests.push({ key: liveKey(g.id, "home"), tokenId: g.tokenIds?.home, fallback: g.odds.home });
        requests.push({ key: liveKey(g.id, "draw"), tokenId: g.tokenIds?.draw, fallback: g.odds.draw });
        requests.push({ key: liveKey(g.id, "away"), tokenId: g.tokenIds?.away, fallback: g.odds.away });
      }
      if (requests.length === 0) return;
      const result = await fetchLivePrices(requests);
      if (cancelled) return;
      setLiveOdds((current) => {
        const next = { ...current };
        for (const id of ids) {
          const g = currentGames.find((game) => game.id === id);
          if (!g) continue;
          next[id] = {
            home: result[liveKey(g.id, "home")],
            draw: result[liveKey(g.id, "draw")],
            away: result[liveKey(g.id, "away")],
          };
        }
        return next;
      });
    };

    void refreshLiveOdds();
    const id = setInterval(() => void refreshLiveOdds(), LIVE_ODDS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [liveOddsKey]);

  // Every team currently listed gets its crest requested — not just a curated "top club" list —
  // so the whole league, not a handful of elite names, shows real logos.
  useEffect(() => {
    if (liveGames.length === 0) return;
    requestLogos(liveGames.flatMap((g) => [g.homeTeam, g.awayTeam]));
  }, [liveGames, requestLogos]);

  // Coming back to a tab that's been sitting open shouldn't show odds well past the 10-minute
  // precision floor — `refresh` itself decides whether that much time has actually passed.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refresh]);

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
    if (selectedIds.size === 0) return;
    // Same reason the single-card Analyze button carries effectiveOdds rather than game.odds — a
    // batch analysis compares against "the market" too, and that has to mean CLOB's current price
    // for each game, not whatever the last general Gamma sweep happened to snapshot.
    setBatchGames(
      liveGames.filter((g) => selectedIds.has(g.id)).map((g) => ({ ...g, odds: liveOdds[g.id] ?? g.odds }))
    );
    setSelectMode(false);
    setSelectedIds(new Set());
  }, [liveGames, selectedIds, liveOdds]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: liveGames.length };
    for (const g of liveGames) c[g.league] = (c[g.league] ?? 0) + 1;
    return c;
  }, [liveGames]);

  const byLeague = useMemo(
    () => (selectedLeagues.length === 0 ? liveGames : liveGames.filter((g) => selectedLeagues.includes(g.league))),
    [liveGames, selectedLeagues]
  );

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
              onClick={() => void refresh({ force: true })}
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
                liveScore={scoreByGameId[game.id] ?? null}
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

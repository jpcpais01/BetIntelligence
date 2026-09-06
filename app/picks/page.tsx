"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SavedPick, Probabilities, LeagueId } from "@/lib/types";
import { pruneFinishedPicks, removePick } from "@/lib/picks";
import PickCard from "@/components/PickCard";
import PickDetailSheet from "@/components/PickDetailSheet";
import { useRequestLogos } from "@/components/ClubLogosProvider";
import { BookmarkIcon } from "@/components/icons";
import { hasKickedOff, isLiveCandidate, isMatchOver } from "@/lib/matchClock";
import { leagueIdByName } from "@/lib/leagues";
import type { LiveScoreEntry } from "@/lib/liveScores";
import { anyTeamNameMatches } from "@/lib/teamNameMatching";
import { liveKey, fetchLivePrices, type LivePriceRequest } from "@/lib/livePrices";

// Same cadence as the Sports page's own live polling (app/sports/page.tsx) — a saved pick whose
// match is underway deserves the same "actually live" treatment a game card gets, not a
// second-class static one just because it lives on a different tab.
const LIVE_SCORE_POLL_MS = 20_000;
const LIVE_ODDS_POLL_MS = 10_000;
const CLOCK_TICK_MS = 30_000;

// Discover (and its saved market picks) is deactivated for now — this page is football-only,
// with no All/Football filter since there's nothing else to filter between. Any market picks
// already saved from before stay in storage untouched (lib/marketPicks.ts), just not read or
// shown here; nothing is deleted.
export default function PicksPage() {
  const [sportsPicks, setSportsPicks] = useState<SavedPick[] | null>(null);
  const [openPick, setOpenPick] = useState<SavedPick | null>(null);
  // Every match result seen so far this session, merged and never dropped — see the poll below.
  const [scoresByMatch, setScoresByMatch] = useState<Record<string, LiveScoreEntry>>({});
  // CLOB's real current price for whichever picks have actually kicked off — the same source
  // GameCard's own live odds come from, refreshed on the same cadence.
  const [liveOdds, setLiveOdds] = useState<Record<string, Probabilities>>({});
  // Read in an effect and advanced on a timer, never called during render: Date.now() is impure,
  // so a memo that called it directly would silently disagree with itself between re-renders.
  const [now, setNow] = useState<number | null>(null);
  const requestLogos = useRequestLogos();

  // Mirrors `sportsPicks` for the live-odds poll below, so that poll can look up a live pick's
  // tokenIds/fallback odds without depending on the picks array itself — depending on it directly
  // would tear down and restart the interval on every incoming score/odds update, the same
  // "never runs at its own cadence" bug the Sports page already hit twice before.
  const picksRef = useRef<SavedPick[] | null>(null);
  useEffect(() => {
    picksRef.current = sportsPicks;
  }, [sportsPicks]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR/hydration */
    setSportsPicks(pruneFinishedPicks());
    setNow(Date.now());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!sportsPicks || sportsPicks.length === 0) return;
    requestLogos(sportsPicks.flatMap((p) => [p.homeTeam, p.awayTeam]));
  }, [sportsPicks, requestLogos]);

  // A SavedPick only ever carries its league's display name, not the LeagueId the live-score API
  // needs — resolved once here and reused by both polling keys below.
  const leagueByPickId = useMemo(() => {
    const map: Record<string, LeagueId> = {};
    for (const p of sportsPicks ?? []) {
      const league = leagueIdByName(p.leagueName);
      if (league) map[p.id] = league;
    }
    return map;
  }, [sportsPicks]);

  // Which pick each known result belongs to, matched the same way the Sports page matches its own
  // games — against both the full and short team names, since for several clubs only the short
  // one is recognisable.
  const scoreByPickId = useMemo(() => {
    const entries = Object.values(scoresByMatch);
    const map: Record<string, LiveScoreEntry> = {};
    for (const p of sportsPicks ?? []) {
      const league = leagueByPickId[p.id];
      if (!league) continue;
      const match = entries.find(
        (s) =>
          s.league === league &&
          anyTeamNameMatches([s.homeTeam, s.homeTeamShort], p.homeTeam) &&
          anyTeamNameMatches([s.awayTeam, s.awayTeamShort], p.awayTeam)
      );
      if (match) map[p.id] = match;
    }
    return map;
  }, [sportsPicks, scoresByMatch, leagueByPickId]);

  // Only ask about leagues that actually have a pick's match in play right now. Keyed off a
  // joined STRING rather than a freshly-built array so both poll effects only re-subscribe when
  // the set genuinely changes, not on every incoming score/price update.
  const scoreLeaguesKey = useMemo(() => {
    if (now === null) return "";
    const leagues = new Set<LeagueId>();
    for (const p of sportsPicks ?? []) {
      const league = leagueByPickId[p.id];
      if (league && isLiveCandidate(p.startTime, scoreByPickId[p.id]?.status, now)) leagues.add(league);
    }
    return [...leagues].sort().join(",");
  }, [sportsPicks, leagueByPickId, scoreByPickId, now]);

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
        // Merged in, never replacing what's already known — same reasoning as the Sports page:
        // each poll only covers the leagues currently in play, so a wholesale replace would wipe
        // every result for a league that had just stopped being polled.
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

  // Picks worth chasing live odds for: kicked off, not yet over. Encoded as a string for the same
  // re-subscribe reason as above.
  const liveOddsKey = useMemo(() => {
    if (now === null) return "";
    return (sportsPicks ?? [])
      .filter((p) => hasKickedOff(p.startTime, now) && !isMatchOver(p.startTime, scoreByPickId[p.id]?.status, now))
      .map((p) => p.id)
      .sort()
      .join(",");
  }, [sportsPicks, scoreByPickId, now]);

  useEffect(() => {
    if (!liveOddsKey) return;
    const ids = liveOddsKey.split(",");

    let cancelled = false;
    const refreshLiveOdds = async () => {
      const currentPicks = picksRef.current ?? [];
      const requests: LivePriceRequest[] = [];
      for (const id of ids) {
        const p = currentPicks.find((pick) => pick.id === id);
        if (!p) continue;
        requests.push({ key: liveKey(p.id, "home"), tokenId: p.tokenIds?.home, fallback: p.market.home });
        requests.push({ key: liveKey(p.id, "draw"), tokenId: p.tokenIds?.draw, fallback: p.market.draw });
        requests.push({ key: liveKey(p.id, "away"), tokenId: p.tokenIds?.away, fallback: p.market.away });
      }
      if (requests.length === 0) return;
      const result = await fetchLivePrices(requests);
      if (cancelled) return;
      setLiveOdds((current) => {
        const next = { ...current };
        for (const id of ids) {
          const p = currentPicks.find((pick) => pick.id === id);
          if (!p) continue;
          next[id] = {
            home: result[liveKey(p.id, "home")],
            draw: result[liveKey(p.id, "draw")],
            away: result[liveKey(p.id, "away")],
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

  const handleRemove = (id: string) => setSportsPicks(removePick(id));

  const valueCount = sportsPicks?.filter((p) => p.comparison.bestValue !== "none").length ?? 0;

  // Ordered by kickoff — the earliest match first, whether it's still upcoming, already live, or
  // finished a while ago — rather than by whenever each one happened to be saved. A schedule read
  // top-to-bottom is what this list is for; save order doesn't mean anything once you have more
  // than a couple of picks.
  const orderedPicks = useMemo(
    () => (sportsPicks ? [...sportsPicks].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()) : null),
    [sportsPicks]
  );

  return (
    <div className="mx-auto max-w-md">
      <div className="safe-top" />

      <div className="px-4 pt-4">
        {sportsPicks && sportsPicks.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border-soft bg-surface p-3.5">
              <p className="text-[11px] text-text-faint">Tracked</p>
              <p className="font-display text-2xl font-bold tabular-nums">{sportsPicks.length}</p>
            </div>
            <div className="rounded-2xl bg-accent/8 p-3.5 ring-1 ring-inset ring-accent/20">
              <p className="text-[11px] text-accent/70">Value spots</p>
              <p className="font-display text-2xl font-bold tabular-nums text-accent">{valueCount}</p>
            </div>
          </div>
        )}

        {sportsPicks !== null && sportsPicks.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-border-soft bg-surface px-5 py-16 text-center">
            <BookmarkIcon className="h-6 w-6 text-text-faint" />
            <p className="max-w-[220px] text-[13px] text-text-dim">
              No saved picks yet. Analyze a match on Sports and save it here.
            </p>
          </div>
        )}

        {orderedPicks !== null && orderedPicks.length > 0 && (
          <div className="space-y-3">
            {orderedPicks.map((pick) => (
              <PickCard
                key={pick.id}
                pick={pick}
                onRemove={handleRemove}
                onOpen={setOpenPick}
                liveScore={scoreByPickId[pick.id] ?? null}
                liveOdds={liveOdds[pick.id] ?? null}
              />
            ))}
          </div>
        )}
      </div>

      {openPick && <PickDetailSheet pick={openPick} onClose={() => setOpenPick(null)} />}
    </div>
  );
}

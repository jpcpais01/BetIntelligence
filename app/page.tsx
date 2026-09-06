"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadDeposits, totalDeposited, STARTING_BALANCE, type Deposit } from "@/lib/portfolio";
import { loadPlacedBets, type PlacedBet } from "@/lib/placedBets";
import { resolvePendingSettlements } from "@/lib/settlement";
import { buildCelebration, type Celebration } from "@/lib/celebration";
import { fetchPriceSeries, liveKey, type LivePriceRequest } from "@/lib/livePrices";
import { buildPortfolioSeries } from "@/lib/portfolioHistory";
import type { HistoryPoint } from "@/lib/oddsHistory";
import { formatEur, toSignedReturnPercent } from "@/lib/format";
import PortfolioChart from "@/components/PortfolioChart";
import PortfolioBetRow from "@/components/PortfolioBetRow";
import WinCelebration from "@/components/WinCelebration";
import EdgeScorePanel from "@/components/EdgeScorePanel";
import { CoinsIcon } from "@/components/icons";

// Bets used to only ever get checked once, right when this page happened to mount — a match that
// finished while the tab sat open just stayed "Pending" until the next full reload. Rechecking on
// an interval means a bet settles on its own, the same way the Sports page's live scores do.
const SETTLEMENT_CHECK_INTERVAL_MS = 60_000;

export default function HomePage() {
  const [deposits, setDeposits] = useState<Deposit[] | null>(null);
  const [bets, setBets] = useState<PlacedBet[] | null>(null);
  const [priceSeries, setPriceSeries] = useState<Record<string, HistoryPoint[]>>({});
  const [visibleCount, setVisibleCount] = useState(5);
  // "Now" is read once on mount (an effect, not render) rather than called fresh on every render —
  // Date.now() is impure, and reading it during render is what the lint rule (and re-render
  // determinism generally) objects to.
  const [now, setNow] = useState<number | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);

  // Mirrors `bets` so the settlement check below can always read the latest value without
  // depending on it directly — a direct dependency would tear down and restart the interval on
  // every settlement, so it would never actually run every SETTLEMENT_CHECK_INTERVAL_MS as
  // intended (the same bug this session already fixed for the Sports page's live-score/odds
  // polling). This stays correct no matter which call site changes `bets` (load, settle, a future
  // one), since it just mirrors the state rather than needing to be updated at each call site.
  const betsRef = useRef<PlacedBet[] | null>(null);
  useEffect(() => {
    betsRef.current = bets;
  }, [bets]);

  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const checkSettlements = useCallback(async (bets: PlacedBet[] | null) => {
    if (!bets || bets.length === 0) return;
    const { bets: settled, newlyWon } = await resolvePendingSettlements(bets);
    if (!mountedRef.current) return;
    setBets(settled);
    if (newlyWon.length > 0) {
      const c = await buildCelebration(newlyWon);
      if (mountedRef.current && c) setCelebration(c);
    }
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR */
    const loaded = loadPlacedBets();
    setDeposits(loadDeposits());
    setBets(loaded);
    setNow(Date.now());
    /* eslint-enable react-hooks/set-state-in-effect */
    void checkSettlements(loaded);
  }, [checkSettlements]);

  // The recurring check reads bets via the ref (mirrored above), never as a direct effect
  // dependency — ticks on its own schedule regardless of how often `bets` itself changes.
  useEffect(() => {
    const id = setInterval(() => void checkSettlements(betsRef.current), SETTLEMENT_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkSettlements]);

  useEffect(() => {
    if (!bets || bets.length === 0) return;
    const requests: LivePriceRequest[] = [];
    for (const bet of bets) {
      for (const leg of bet.legs) {
        if (leg.tokenId) requests.push({ key: liveKey(leg.pickId, leg.outcomeLabel), tokenId: leg.tokenId, fallback: leg.marketProb });
      }
    }
    let cancelled = false;
    fetchPriceSeries(requests).then((result) => {
      if (!cancelled) setPriceSeries(result);
    });
    return () => {
      cancelled = true;
    };
  }, [bets]);

  const series = useMemo(() => {
    if (!deposits || !bets || now === null) return null;
    return buildPortfolioSeries(deposits, bets, priceSeries, now);
  }, [deposits, bets, priceSeries, now]);

  const baseline = deposits ? totalDeposited(deposits) : STARTING_BALANCE;
  const currentValue = series && series.length > 0 ? series[series.length - 1].value : baseline;
  const allTimePnl = currentValue - baseline;
  const allTimePnlPct = baseline > 0 ? allTimePnl / baseline : 0;
  const positive = allTimePnl > 0.005;
  const negative = allTimePnl < -0.005;

  const sortedBets = bets ? [...bets].sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime()) : null;
  const visibleBets = sortedBets?.slice(0, visibleCount) ?? [];

  return (
    <div className="mx-auto max-w-md">
      <header className="safe-top sticky top-0 z-30 bg-bg/85 px-5 pb-4 backdrop-blur-xl">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-text">Home</h1>
        <p className="text-[12px] text-text-faint">Your paper portfolio</p>
      </header>

      <div className="px-4 pt-1 pb-8">
        <div
          className="surface-glow relative overflow-hidden rounded-3xl border border-border-soft p-5"
          style={{ ["--lift-rgb" as string]: positive ? "var(--accent-rgb)" : negative ? "var(--accent-3-rgb)" : "155, 161, 172" }}
        >
          <div className="ambient-glow" />
          <div className="relative">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-faint">Portfolio value</p>
            <p className="glow-num font-display text-[38px] font-bold tabular-nums leading-none text-text">
              {formatEur(currentValue)}
            </p>
            <p
              className="mt-2 text-[12px] font-semibold tabular-nums"
              style={{ color: positive ? "var(--accent)" : negative ? "var(--accent-3)" : "var(--text-faint)" }}
            >
              {allTimePnl >= 0 ? "+" : ""}
              {formatEur(allTimePnl)} ({toSignedReturnPercent(allTimePnlPct)}) all time
            </p>
          </div>

          <div className="relative mt-4">
            <PortfolioChart series={series ?? []} />
          </div>
        </div>

        <div className="mt-4">
          <EdgeScorePanel bets={bets ?? []} />
        </div>

        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-[15px] font-bold text-text">Recent bets</h2>
            {sortedBets && sortedBets.length > 5 && (
              <button
                onClick={() => setVisibleCount((v) => (v === 5 ? 10 : 5))}
                className="press rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-accent"
              >
                {visibleCount === 5 ? "Show 10" : "Show 5"}
              </button>
            )}
          </div>

          {sortedBets === null && <div className="py-10" />}

          {sortedBets !== null && sortedBets.length === 0 && (
            <div className="surface-lift flex flex-col items-center gap-2.5 rounded-3xl border border-border-soft px-5 py-14 text-center">
              <CoinsIcon className="h-6 w-6 text-text-faint" />
              <p className="max-w-[240px] text-[13px] text-text-dim">
                No bets placed yet. Build a slip in Lab and tap Buy to see it here.
              </p>
            </div>
          )}

          {visibleBets.length > 0 && (
            <div className="space-y-2">
              {visibleBets.map((bet) => (
                <PortfolioBetRow key={bet.id} bet={bet} priceSeriesByKey={priceSeries} now={now ?? 0} />
              ))}
            </div>
          )}
        </div>
      </div>

      {celebration && (
        <WinCelebration
          teams={celebration.teams}
          fallEmojis={celebration.fallEmojis}
          bgColors={celebration.bgColors}
          onClose={() => setCelebration(null)}
        />
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { loadDeposits, addFunds, totalDeposited, STARTING_BALANCE, type Deposit } from "@/lib/portfolio";
import { loadPlacedBets, type PlacedBet } from "@/lib/placedBets";
import { resolvePendingSettlements } from "@/lib/settlement";
import { fetchPriceSeries, liveKey, type LivePriceRequest } from "@/lib/livePrices";
import { buildPortfolioSeries } from "@/lib/portfolioHistory";
import type { HistoryPoint } from "@/lib/oddsHistory";
import { formatEur, toSignedReturnPercent } from "@/lib/format";
import PortfolioChart from "@/components/PortfolioChart";
import PortfolioBetRow from "@/components/PortfolioBetRow";
import { PlusIcon, CloseIcon, CoinsIcon } from "@/components/icons";

const QUICK_ADD_AMOUNTS = [50, 100, 250, 500];

export default function HomePage() {
  const [deposits, setDeposits] = useState<Deposit[] | null>(null);
  const [bets, setBets] = useState<PlacedBet[] | null>(null);
  const [priceSeries, setPriceSeries] = useState<Record<string, HistoryPoint[]>>({});
  const [showAddFunds, setShowAddFunds] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);
  // "Now" is read once on mount (an effect, not render) rather than called fresh on every render —
  // Date.now() is impure, and reading it during render is what the lint rule (and re-render
  // determinism generally) objects to.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR */
    const loaded = loadPlacedBets();
    setDeposits(loadDeposits());
    setBets(loaded);
    setNow(Date.now());
    /* eslint-enable react-hooks/set-state-in-effect */

    let cancelled = false;
    resolvePendingSettlements(loaded).then((settled) => {
      if (!cancelled) setBets(settled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const handleAddFunds = (amount: number) => {
    addFunds(amount);
    setDeposits(loadDeposits());
    setShowAddFunds(false);
  };

  const sortedBets = bets ? [...bets].sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime()) : null;
  const visibleBets = sortedBets?.slice(0, visibleCount) ?? [];

  return (
    <div className="mx-auto max-w-md">
      <header className="safe-top sticky top-0 z-30 border-b border-border-soft bg-bg/85 px-4 pb-3 backdrop-blur-xl">
        <h1 className="font-display text-[19px] font-bold tracking-tight text-text">Home</h1>
        <p className="text-[11px] text-text-faint">Your paper portfolio</p>
      </header>

      <div className="px-4 pt-4 pb-6">
        <div className="rounded-2xl border border-border-soft bg-surface p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-faint">Portfolio value</p>
              <p className="font-display text-[32px] font-bold tabular-nums text-text">{formatEur(currentValue)}</p>
              <p
                className="mt-0.5 text-[12px] font-medium tabular-nums"
                style={{ color: positive ? "var(--accent)" : negative ? "var(--accent-3)" : "var(--text-faint)" }}
              >
                {allTimePnl >= 0 ? "+" : ""}
                {formatEur(allTimePnl)} ({toSignedReturnPercent(allTimePnlPct)}) all time
              </p>
            </div>
            <button
              onClick={() => setShowAddFunds(true)}
              className="press flex shrink-0 items-center gap-1 rounded-full bg-accent/12 px-3 py-2 text-[11px] font-semibold text-accent ring-1 ring-inset ring-accent/25"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add funds
            </button>
          </div>

          <div className="mt-4">
            <PortfolioChart series={series ?? []} />
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-text">Recent bets</h2>
            {sortedBets && sortedBets.length > 5 && (
              <button
                onClick={() => setVisibleCount((v) => (v === 5 ? 10 : 5))}
                className="press text-[11px] font-medium text-accent"
              >
                {visibleCount === 5 ? "Show 10" : "Show 5"}
              </button>
            )}
          </div>

          {sortedBets === null && <div className="py-10" />}

          {sortedBets !== null && sortedBets.length === 0 && (
            <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-border-soft bg-surface px-5 py-12 text-center">
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

      {showAddFunds && <AddFundsModal onClose={() => setShowAddFunds(false)} onConfirm={handleAddFunds} />}
    </div>
  );
}

function AddFundsModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (amount: number) => void }) {
  const [custom, setCustom] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="pop-in w-full max-w-xs rounded-3xl border border-border-soft bg-bg-elevated p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[14px] font-bold text-text">Add funds</p>
          <button onClick={onClose} aria-label="Close" className="press text-text-faint">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {QUICK_ADD_AMOUNTS.map((amount) => (
            <button
              key={amount}
              onClick={() => onConfirm(amount)}
              className="press rounded-xl bg-surface-2 py-3 text-[13px] font-bold tabular-nums text-text"
            >
              {formatEur(amount)}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="Custom amount"
            inputMode="decimal"
            className="w-full rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] text-text placeholder:text-text-faint focus:outline-none"
          />
          <button
            onClick={() => {
              const amount = parseFloat(custom);
              if (Number.isFinite(amount) && amount > 0) onConfirm(amount);
            }}
            className="press shrink-0 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-bold text-bg"
          >
            Add
          </button>
        </div>

        <p className="mt-3 text-center text-[10px] text-text-faint">Paper trade only &middot; no real money moves</p>
      </div>
    </div>
  );
}

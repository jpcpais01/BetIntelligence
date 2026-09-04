"use client";

import { useEffect, useMemo, useState } from "react";
import type { SlipLeg } from "@/lib/betslip";
import { combineSlip } from "@/lib/betslip";
import { placeBet } from "@/lib/placedBets";
import { DEFAULT_STAKE, QUICK_STAKES } from "@/lib/portfolio";
import { liveKey } from "@/lib/livePrices";
import { toPercent, toSignedPercent, toDecimalOdds, formatEur } from "@/lib/format";
import { TicketIcon, XCircleIcon, ChevronDownIcon, ScaleIcon, CoinsIcon } from "./icons";

const BUYING_MS = 700;
const SUCCESS_MS = 2400;
const CONFETTI_COLORS = ["var(--lab-gold)", "var(--lab-pink)", "var(--lab-cyan)", "var(--lab-green)"];

function liveMarketFor(leg: SlipLeg, livePrices: Record<string, number>): number {
  return livePrices[liveKey(leg.pickId, leg.outcomeLabel)] ?? leg.marketProb;
}

export default function BetSlipBar({
  legs,
  livePrices,
  onRemove,
  onClear,
  onPlaced,
}: {
  legs: SlipLeg[];
  livePrices: Record<string, number>;
  onRemove: (pickId: string) => void;
  onClear: () => void;
  onPlaced?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [stake, setStake] = useState(DEFAULT_STAKE);
  const [buying, setBuying] = useState(false);
  const [placedLegCount, setPlacedLegCount] = useState<number | null>(null);
  const [placedOdds, setPlacedOdds] = useState<string | null>(null);
  const [placedStake, setPlacedStake] = useState<number | null>(null);

  // Buying always transacts at today's price, not whatever the market showed back when the pick
  // was analyzed — pricedLegs substitutes each leg's live market probability in before the combined
  // stats (and the placed-bet snapshot itself) get computed.
  const pricedLegs = useMemo(
    () => legs.map((leg) => ({ ...leg, marketProb: liveMarketFor(leg, livePrices) })),
    [legs, livePrices]
  );
  const combined = useMemo(() => combineSlip(pricedLegs), [pricedLegs]);

  const handleBuy = () => {
    if (legs.length === 0 || buying) return;
    setBuying(true);
    window.setTimeout(() => {
      placeBet(pricedLegs, combined, stake);
      setPlacedLegCount(legs.length);
      setPlacedOdds(toDecimalOdds(combined.marketProb));
      setPlacedStake(stake);
      setBuying(false);
      setExpanded(false);
      onClear();
      onPlaced?.();
      window.setTimeout(() => {
        setPlacedLegCount(null);
        setPlacedOdds(null);
        setPlacedStake(null);
      }, SUCCESS_MS);
    }, BUYING_MS);
  };

  if (legs.length === 0 && placedLegCount === null) return null;

  return (
    <>
      {placedLegCount !== null && (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center px-6">
          <div className="lab-pop-in relative overflow-visible rounded-3xl border border-[var(--lab-gold)]/40 bg-[var(--lab-surface)] px-7 py-6 text-center shadow-2xl">
            <ConfettiBurst />
            <p className="text-3xl">🎉</p>
            <p className="mt-2 font-display text-[17px] font-bold text-text">Bet placed!</p>
            <p className="mt-1 text-[12px] text-text-dim">
              {placedStake !== null ? formatEur(placedStake) : ""} &middot; {placedLegCount} leg
              {placedLegCount === 1 ? "" : "s"} &middot; {placedOdds}x
            </p>
            <p className="mt-2 text-[10px] uppercase tracking-wide text-text-faint">
              Paper trade &middot; find it under My Bets
            </p>
          </div>
        </div>
      )}

      {legs.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(74px+env(safe-area-inset-bottom))] z-[45] mx-auto max-w-md px-4">
          {!expanded ? (
            <button
              onClick={() => setExpanded(true)}
              className="lab-pop-in press flex w-full items-center justify-between gap-3 rounded-full px-4 py-3 shadow-xl"
              style={{ background: "var(--lab-surface-2)", border: "1px solid var(--lab-border)" }}
            >
              <span className="flex items-center gap-2">
                <span
                  key={legs.length}
                  className="lab-coin-bounce flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                  style={{ background: "var(--lab-gold)", color: "#1a0f05" }}
                >
                  {legs.length}
                </span>
                <span className="text-[12px] font-semibold text-text">
                  {legs.length === 1 ? "1 leg" : `${legs.length}-leg parlay`}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-[12px] font-bold tabular-nums" style={{ color: "var(--lab-gold)" }}>
                {toDecimalOdds(combined.marketProb)}x
                <ChevronDownIcon className="h-3.5 w-3.5 rotate-180" />
              </span>
            </button>
          ) : (
            <div
              className="lab-slide-up max-h-[70vh] overflow-y-auto rounded-3xl shadow-2xl"
              style={{ background: "var(--lab-surface)", border: "1px solid var(--lab-border)" }}
            >
              <div className="sticky top-0 z-10 rounded-t-3xl pt-2" style={{ background: "var(--lab-surface)" }}>
                <button
                  onClick={() => setExpanded(false)}
                  aria-label="Collapse slip"
                  className="press flex w-full items-center justify-center py-1 text-text-faint"
                >
                  <ChevronDownIcon className="h-4 w-4" />
                </button>
                <div className="flex items-center justify-between gap-2 px-4 pb-2">
                  <span className="flex items-center gap-1.5 text-[13px] font-bold text-text">
                    <TicketIcon className="h-4 w-4" style={{ color: "var(--lab-gold)" }} />
                    Your slip
                  </span>
                  <button onClick={onClear} className="press text-[11px] font-medium text-text-faint hover:text-[var(--lab-red)]">
                    Clear
                  </button>
                </div>
              </div>

              <div className="space-y-2 px-4 pb-2">
                {legs.map((leg) => (
                  <LabLegRow
                    key={leg.pickId}
                    leg={leg}
                    liveMarket={liveMarketFor(leg, livePrices)}
                    onRemove={() => onRemove(leg.pickId)}
                  />
                ))}
              </div>

              {legs.length > 1 && (
                <div className="mx-4 mb-3 space-y-2.5 rounded-2xl p-3.5" style={{ background: "var(--lab-surface-2)" }}>
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-text-faint">
                    <ScaleIcon className="h-3 w-3" />
                    Combined ({legs.length}-leg parlay)
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <LabStat label="Odds" value={`${toDecimalOdds(combined.marketProb)}x`} />
                    <LabStat label="AI prob" value={toPercent(combined.aiProb)} accent="cyan" />
                    <LabStat
                      label="Edge"
                      value={toSignedPercent(combined.edge)}
                      accent={combined.edge > 0.005 ? "green" : combined.edge < -0.005 ? "red" : undefined}
                    />
                  </div>
                </div>
              )}

              <div className="px-4 pb-2">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-faint">Stake</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {QUICK_STAKES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStake(s)}
                      className="press rounded-xl py-2 text-[12px] font-bold tabular-nums"
                      style={
                        stake === s
                          ? { background: "var(--lab-gold)", color: "#1a0f05" }
                          : { background: "var(--lab-surface-2)", color: "var(--text-dim)" }
                      }
                    >
                      €{s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-4 pb-4">
                <button
                  onClick={handleBuy}
                  disabled={buying}
                  className={`lab-cta press flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[14px] font-bold ${buying ? "lab-buy-pulse" : ""}`}
                >
                  <CoinsIcon className="h-4 w-4" />
                  {buying ? "Placing..." : `Buy ${formatEur(stake)} at ${toDecimalOdds(combined.marketProb)}x`}
                </button>
                <p className="mt-2 text-center text-[10px] text-text-faint">
                  Paper trade only &middot; no real money moves
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function LabLegRow({ leg, liveMarket, onRemove }: { leg: SlipLeg; liveMarket: number; onRemove: () => void }) {
  const edge = leg.aiProb - liveMarket;
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5" style={{ background: "var(--lab-surface-2)" }}>
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-text">
          {leg.outcomeLabel}
          <span className="ml-1.5 font-normal text-text-faint">&middot; {leg.title}</span>
        </p>
        <p className="text-[10px] tabular-nums text-text-faint">
          {toDecimalOdds(liveMarket)}x &middot; AI {toPercent(leg.aiProb)} &middot;{" "}
          <span style={{ color: edge > 0.005 ? "var(--lab-green)" : edge < -0.005 ? "var(--lab-red)" : undefined }}>
            {toSignedPercent(edge)}
          </span>
        </p>
      </div>
      <button onClick={onRemove} aria-label="Remove leg" className="press shrink-0 text-text-faint hover:text-[var(--lab-red)]">
        <XCircleIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function LabStat({ label, value, accent }: { label: string; value: string; accent?: "cyan" | "green" | "red" }) {
  const color = accent === "cyan" ? "var(--lab-cyan)" : accent === "green" ? "var(--lab-green)" : accent === "red" ? "var(--lab-red)" : "var(--text)";
  return (
    <div className="rounded-xl px-2 py-2 text-center" style={{ background: "var(--lab-bg-2)" }}>
      <p className="text-[9px] text-text-faint">{label}</p>
      <p className="font-display text-[13px] font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

interface ConfettiPiece {
  left: number;
  delay: number;
  duration: number;
  color: string;
  size: number;
}

function ConfettiBurst() {
  // Randomizing piece placement is a one-off visual flourish, not derived state — generating it
  // in an effect (rather than during render, e.g. useMemo) keeps render itself pure.
  const [pieces, setPieces] = useState<ConfettiPiece[] | null>(null);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-off randomized visual on mount, not state synced from anything */
    setPieces(
      Array.from({ length: 16 }, (_, i) => ({
        left: 4 + Math.random() * 92,
        delay: Math.random() * 0.25,
        duration: 0.8 + Math.random() * 0.5,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 5 + Math.random() * 4,
      }))
    );
  }, []);
  if (!pieces) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 -top-2 h-0 overflow-visible">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="lab-confetti-piece rounded-sm"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 1.6,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

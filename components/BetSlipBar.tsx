"use client";

import { useEffect, useMemo, useState } from "react";
import type { SlipLeg } from "@/lib/betslip";
import { combineSlip } from "@/lib/betslip";
import { placeBet } from "@/lib/placedBets";
import { DEFAULT_STAKE, QUICK_STAKES } from "@/lib/portfolio";
import { liveKey } from "@/lib/livePrices";
import { toPercent, toSignedPercent, toDecimalOdds, formatEur, formatUsd } from "@/lib/format";
import type { BetMode } from "@/lib/realMoney/mode";
import { placeRealMarketBuy, type WalletConnection } from "@/lib/realMoney/clob";
import { TicketIcon, XCircleIcon, ChevronDownIcon, ScaleIcon, CoinsIcon } from "./icons";

const BUYING_MS = 700;
const SUCCESS_MS = 2400;
const CONFETTI_COLORS = ["var(--slip-gold)", "var(--slip-pink)", "var(--slip-cyan)", "var(--slip-green)"];

// Where a real order can actually be checked/claimed afterward — this app places the order but
// never handles payout itself, so every real receipt points back here rather than to a specific
// event page (a football-originated leg carries no Polymarket slug/URL of its own to link to,
// only a market-kind Discover pick does).
const POLYMARKET_PORTFOLIO_URL = "https://polymarket.com/portfolio";

function liveMarketFor(leg: SlipLeg, livePrices: Record<string, number>): number {
  return livePrices[liveKey(leg.pickId, leg.outcomeLabel)] ?? leg.marketProb;
}

export default function BetSlipBar({
  legs,
  livePrices,
  betMode,
  wallet,
  onRemove,
  onClear,
  onPlaced,
}: {
  legs: SlipLeg[];
  livePrices: Record<string, number>;
  betMode: BetMode;
  wallet: WalletConnection | null;
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
  const [placedReal, setPlacedReal] = useState(false);

  // A real order is a single Polymarket market order, never a parlay (there is no such thing as
  // an atomic multi-leg order on Polymarket — each leg is its own independent market) and never a
  // 1X/X2 combo (no single CLOB token prices a double chance, so there's nothing to actually buy).
  //
  // Identifies WHICH exact leg+stake the confirm step is for, rather than a bare boolean — so it
  // naturally reads back as "not confirming" the instant the leg or stake it was shown for changes
  // underneath it (a leg added/removed, the stake bumped), with no separate effect needed to reset
  // it. Confirming a stale amount/leg is exactly the kind of "wait, that's not what I meant to buy"
  // a real order can't be undone from.
  const [realConfirmingFor, setRealConfirmingFor] = useState<{ pickId: string; outcomeLabel: string; stake: number } | null>(null);
  const [realSubmitting, setRealSubmitting] = useState(false);
  const [realError, setRealError] = useState<string | null>(null);

  // Buying always transacts at today's price, not whatever the market showed back when the pick
  // was analyzed — pricedLegs substitutes each leg's live market probability in before the combined
  // stats (and the placed-bet snapshot itself) get computed.
  const pricedLegs = useMemo(
    () => legs.map((leg) => ({ ...leg, marketProb: liveMarketFor(leg, livePrices) })),
    [legs, livePrices]
  );
  const combined = useMemo(() => combineSlip(pricedLegs), [pricedLegs]);

  const realLeg = betMode === "real" && pricedLegs.length === 1 ? pricedLegs[0] : null;
  const realBlockedReason =
    betMode !== "real"
      ? null
      : pricedLegs.length === 0
        ? null
        : pricedLegs.length > 1
          ? "Real mode places one order at a time — Polymarket has no combined-parlay order type. Remove legs down to one, or switch back to Paper."
          : !realLeg?.tokenId
            ? "This pick has no tradeable token for a real order — a 1X/X2 combo has no single market to buy (Polymarket prices each side of a match, never the double chance itself)."
            : null;
  const canPlaceReal = betMode === "real" && wallet !== null && realLeg !== null && !!realLeg.tokenId && !realBlockedReason;
  const realConfirming =
    realConfirmingFor !== null &&
    realLeg !== null &&
    realConfirmingFor.pickId === realLeg.pickId &&
    realConfirmingFor.outcomeLabel === realLeg.outcomeLabel &&
    realConfirmingFor.stake === stake;

  const handleBuy = () => {
    if (legs.length === 0 || buying) return;

    if (betMode === "real") {
      if (!canPlaceReal || !realLeg || !wallet) return;
      if (!realConfirming) {
        setRealConfirmingFor({ pickId: realLeg.pickId, outcomeLabel: realLeg.outcomeLabel, stake });
        setRealError(null);
        return;
      }
      setRealSubmitting(true);
      setRealError(null);
      placeRealMarketBuy(wallet, { tokenId: realLeg.tokenId as string, usdcAmount: stake })
        .then((result) => {
          placeBet([realLeg], combineSlip([realLeg]), stake, {
            orderId: result.orderId,
            polymarketUrl: POLYMARKET_PORTFOLIO_URL,
          });
          setPlacedLegCount(1);
          setPlacedOdds(toDecimalOdds(realLeg.marketProb));
          setPlacedStake(stake);
          setPlacedReal(true);
          setRealConfirmingFor(null);
          setExpanded(false);
          onClear();
          onPlaced?.();
          window.setTimeout(() => {
            setPlacedLegCount(null);
            setPlacedOdds(null);
            setPlacedStake(null);
            setPlacedReal(false);
          }, SUCCESS_MS);
        })
        .catch((err) => {
          setRealError(err instanceof Error ? err.message : "Polymarket rejected this order.");
        })
        .finally(() => setRealSubmitting(false));
      return;
    }

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
          <div className="lab-pop-in relative overflow-visible rounded-3xl border border-[var(--slip-gold)]/40 bg-[var(--slip-surface)] px-7 py-6 text-center shadow-2xl">
            <ConfettiBurst />
            <p className="text-3xl">{placedReal ? "💸" : "🎉"}</p>
            <p className="mt-2 font-display text-[17px] font-bold text-text">
              {placedReal ? "Real order placed!" : "Bet placed!"}
            </p>
            <p className="mt-1 text-[12px] text-text-dim">
              {placedStake !== null ? (placedReal ? formatUsd(placedStake) : formatEur(placedStake)) : ""} &middot;{" "}
              {placedLegCount} leg
              {placedLegCount === 1 ? "" : "s"} &middot; {placedOdds}x
            </p>
            <p className="mt-2 text-[10px] uppercase tracking-wide text-text-faint">
              {placedReal ? (
                <>
                  Real money &middot;{" "}
                  <a href={POLYMARKET_PORTFOLIO_URL} target="_blank" rel="noreferrer" className="underline">
                    view on Polymarket
                  </a>
                </>
              ) : (
                "Paper trade · find it under My Bets"
              )}
            </p>
          </div>
        </div>
      )}

      {/* The page dimmed behind the open slip, so it reads as a layer above everything rather than
          a panel sat on top of it — and gives an obvious "tap anywhere else to close" target.
          Kept mounted and toggled via opacity/visibility so it fades BOTH ways; unmounting it on
          collapse would make it vanish instantly while the sheet was still closing. */}
      {legs.length > 0 && (
        <div
          className="lab-slip-scrim z-[44]"
          onClick={() => setExpanded(false)}
          aria-hidden={!expanded}
          style={{
            opacity: expanded ? 1 : 0,
            visibility: expanded ? "visible" : "hidden",
          }}
        />
      )}

      {legs.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(92px+env(safe-area-inset-bottom))] z-[45] mx-auto max-w-md px-4">
          <div
            className={`lab-slip-sheen lab-slip-morph shadow-xl ${betMode === "real" ? "real-mode-shine" : ""}`}
            style={{
              background: "var(--slip-surface-2)",
              border: "1px solid var(--slip-border)",
              borderRadius: expanded ? "28px" : "999px",
            }}
          >
            <button
              onClick={() => setExpanded((v) => !v)}
              className="press relative z-[1] flex w-full items-center justify-between gap-3 px-4 py-3"
            >
              <span className="flex items-center gap-2">
                <span
                  key={legs.length}
                  className="lab-coin-bounce flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                  style={{ background: "var(--slip-gold)", color: "#1a0f05" }}
                >
                  {legs.length}
                </span>
                <span className="text-[12px] font-semibold text-text">
                  {legs.length} bet{legs.length === 1 ? "" : "s"}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-[12px] font-bold tabular-nums" style={{ color: "var(--slip-gold)" }}>
                {toDecimalOdds(combined.marketProb)}x
                <span style={{ color: combined.edge > 0.005 ? "var(--slip-green)" : combined.edge < -0.005 ? "var(--slip-red)" : "var(--text-faint)" }}>
                  {toSignedPercent(combined.edge)}
                </span>
                <ChevronDownIcon
                  className={`h-3.5 w-3.5 transition-transform duration-300 ${expanded ? "" : "rotate-180"}`}
                />
              </span>
            </button>

            {/* Expanding via grid-template-rows (0fr -> 1fr) rather than swapping in a whole other
                element lets the body grow to its own natural height smoothly, no JS measuring
                needed — combined with the pill's own border-radius morphing above, the whole thing
                reads as one shape growing rather than a hard cut between two different elements. */}
            <div
              className="relative z-[1]"
              style={{
                display: "grid",
                gridTemplateRows: expanded ? "1fr" : "0fr",
                transition: "grid-template-rows 0.45s var(--ease-soft)",
              }}
            >
              <div className="min-h-0 overflow-hidden">
                {/* The bounce the shape itself can't have (see .lab-slip-morph) lives here: the
                    contents spring up into place a beat behind the sheet opening, which is what
                    actually sells the whole thing as one gooey object stretching open. */}
                <div
                  className="max-h-[60vh] overflow-y-auto px-4 pb-4"
                  style={{
                    opacity: expanded ? 1 : 0,
                    transform: expanded ? "translateY(0)" : "translateY(-10px)",
                    transition:
                      "opacity 0.3s var(--ease-soft) 0.06s, transform 0.5s var(--ease-spring) 0.06s",
                  }}
                >
                  <div className="flex items-center justify-between gap-2 pb-2 pt-1">
                    <span className="flex items-center gap-1.5 text-[13px] font-bold text-text">
                      <TicketIcon className="h-4 w-4" style={{ color: "var(--slip-gold)" }} />
                      Your slip
                    </span>
                    <button onClick={onClear} className="press text-[11px] font-medium text-text-faint hover:text-[var(--slip-red)]">
                      Clear
                    </button>
                  </div>

                  <div className="space-y-2">
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
                    <div className="mt-2 space-y-2.5 rounded-2xl p-3.5" style={{ background: "var(--slip-bg-2)" }}>
                      <p className="flex items-center gap-1.5 text-[11px] font-medium text-text-faint">
                        <ScaleIcon className="h-3 w-3" />
                        Combined ({legs.length}-leg parlay)
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        <LabStat label="Odds" value={`${toDecimalOdds(combined.marketProb)}x`} sub={toPercent(combined.marketProb)} />
                        <LabStat label="AI prob" value={toPercent(combined.aiProb)} accent="cyan" />
                        <LabStat
                          label="Edge"
                          value={toSignedPercent(combined.edge)}
                          accent={combined.edge > 0.005 ? "green" : combined.edge < -0.005 ? "red" : undefined}
                        />
                      </div>
                    </div>
                  )}

                  <p className="mb-1.5 mt-3 text-[10px] font-medium uppercase tracking-wide text-text-faint">Stake</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {QUICK_STAKES.map((s) => (
                      <button
                        key={s}
                        onClick={() => setStake(s)}
                        className="press rounded-xl py-2 text-[12px] font-bold tabular-nums"
                        style={
                          stake === s
                            ? { background: "var(--slip-gold)", color: "#1a0f05" }
                            : { background: "var(--slip-bg-2)", color: "var(--text-dim)" }
                        }
                      >
                        {betMode === "real" ? "$" : "€"}
                        {s}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3">
                    {betMode === "real" ? (
                      <RealBuySection
                        blockedReason={realBlockedReason}
                        walletConnected={wallet !== null}
                        confirming={realConfirming}
                        submitting={realSubmitting}
                        error={realError}
                        stake={stake}
                        odds={realLeg ? toDecimalOdds(realLeg.marketProb) : "—"}
                        onBuy={handleBuy}
                        onCancelConfirm={() => setRealConfirmingFor(null)}
                      />
                    ) : (
                      <>
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
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RealBuySection({
  blockedReason,
  walletConnected,
  confirming,
  submitting,
  error,
  stake,
  odds,
  onBuy,
  onCancelConfirm,
}: {
  blockedReason: string | null;
  walletConnected: boolean;
  confirming: boolean;
  submitting: boolean;
  error: string | null;
  stake: number;
  odds: string;
  onBuy: () => void;
  onCancelConfirm: () => void;
}) {
  if (!walletConnected) {
    return (
      <p className="rounded-2xl p-3.5 text-center text-[12px]" style={{ background: "rgba(var(--lab-red-rgb), 0.1)", color: "var(--lab-red)" }}>
        Connect your Polymarket wallet (the wallet icon above) to place a real order.
      </p>
    );
  }

  if (blockedReason) {
    return (
      <p className="rounded-2xl p-3.5 text-center text-[12px]" style={{ background: "rgba(var(--lab-red-rgb), 0.1)", color: "var(--lab-red)" }}>
        {blockedReason}
      </p>
    );
  }

  if (confirming) {
    return (
      <div className="space-y-2.5 rounded-2xl p-3.5" style={{ background: "rgba(var(--lab-red-rgb), 0.1)" }}>
        <p className="text-center text-[12px] font-bold" style={{ color: "var(--lab-red)" }}>
          Confirm real order: {formatUsd(stake)} at {odds}x
        </p>
        <p className="text-center text-[10px] text-text-dim">
          This submits an immediate buy order to Polymarket with real USDC. It cannot be undone.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancelConfirm}
            disabled={submitting}
            className="press flex-1 rounded-full py-2.5 text-[12px] font-semibold disabled:opacity-40"
            style={{ background: "var(--slip-bg-2)", color: "var(--text-dim)" }}
          >
            Cancel
          </button>
          <button
            onClick={onBuy}
            disabled={submitting}
            className="press flex-1 rounded-full py-2.5 text-[12px] font-bold disabled:opacity-40"
            style={{ background: "var(--lab-red)", color: "#1a0f05" }}
          >
            {submitting ? "Placing..." : "Place real order"}
          </button>
        </div>
        {error && <p className="text-center text-[11px]" style={{ color: "var(--lab-red)" }}>{error}</p>}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={onBuy}
        className="real-mode-shine press flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[14px] font-bold"
        style={{ background: "var(--lab-bg-2)", color: "var(--lab-gold)" }}
      >
        <CoinsIcon className="h-4 w-4" />
        Buy {formatUsd(stake)} at {odds}x — real money
      </button>
      {error && <p className="mt-2 text-center text-[11px]" style={{ color: "var(--lab-red)" }}>{error}</p>}
      <p className="mt-2 text-center text-[10px] text-text-faint">Real USDC · an immediate market order, no resting order left open</p>
    </>
  );
}

function LabLegRow({ leg, liveMarket, onRemove }: { leg: SlipLeg; liveMarket: number; onRemove: () => void }) {
  const edge = leg.aiProb - liveMarket;
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5" style={{ background: "var(--slip-surface-2)" }}>
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-text">
          {leg.outcomeLabel}
          <span className="ml-1.5 font-normal text-text-faint">&middot; {leg.title}</span>
        </p>
        <p className="text-[10px] tabular-nums text-text-faint">
          {toDecimalOdds(liveMarket)}x ({toPercent(liveMarket)}) &middot; AI {toPercent(leg.aiProb)} &middot;{" "}
          <span style={{ color: edge > 0.005 ? "var(--slip-green)" : edge < -0.005 ? "var(--slip-red)" : undefined }}>
            {toSignedPercent(edge)}
          </span>
        </p>
      </div>
      <button onClick={onRemove} aria-label="Remove leg" className="press shrink-0 text-text-faint hover:text-[var(--slip-red)]">
        <XCircleIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function LabStat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "cyan" | "green" | "red";
}) {
  const color = accent === "cyan" ? "var(--slip-cyan)" : accent === "green" ? "var(--slip-green)" : accent === "red" ? "var(--slip-red)" : "var(--text)";
  return (
    <div className="rounded-xl px-2 py-2 text-center" style={{ background: "var(--slip-bg-2)" }}>
      <p className="text-[9px] text-text-faint">{label}</p>
      <p className="flex items-baseline justify-center gap-1">
        <span className="font-display text-[13px] font-bold tabular-nums" style={{ color }}>
          {value}
        </span>
        {sub && <span className="text-[9px] font-medium tabular-nums text-text-faint">{sub}</span>}
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

import type { PlacedBet } from "@/lib/placedBets";
import type { HistoryPoint } from "@/lib/oddsHistory";
import { computeBetValue } from "@/lib/portfolioHistory";
import { formatEur, formatRelativeTime, toSignedReturnPercent, toDecimalOdds } from "@/lib/format";

// Won green, lost red, still open neutral — the one scale every result-colored thing in this row
// shares, so the odds and each individual leg are read the same way without a legend.
function resultColor(result: "won" | "lost" | "pending" | undefined): string {
  if (result === "won") return "var(--accent)";
  if (result === "lost") return "var(--accent-3)";
  return "var(--text-dim)";
}

export default function PortfolioBetRow({
  bet,
  priceSeriesByKey,
  now,
}: {
  bet: PlacedBet;
  priceSeriesByKey: Record<string, HistoryPoint[]>;
  now: number;
}) {
  const currentValue = computeBetValue(bet, priceSeriesByKey, now);
  const pnl = currentValue - bet.stake;
  const pnlPct = bet.stake > 0 ? pnl / bet.stake : 0;
  const positive = pnl > 0.005;
  const negative = pnl < -0.005;
  const { settlement, legResults } = bet;

  // The odds the bet was actually taken at, standing in for what used to be a generic ticket icon:
  // the single number that says what this bet was worth doing, colored by how it turned out. Each
  // leg's own label is colored by ITS own result rather than the bet's, so a parlay that's already
  // lost still shows which of its legs came in — the whole point of tracking legs separately
  // (lib/settlement.ts's per-leg results).
  const oddsColor = resultColor(settlement?.status);

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface p-3">
      <div
        className="flex h-8 shrink-0 items-center justify-center rounded-full px-2.5"
        style={{
          background: settlement ? `color-mix(in srgb, ${oddsColor} 12%, transparent)` : "var(--surface-2)",
          color: oddsColor,
        }}
      >
        <span className="font-display text-[12px] font-bold tabular-nums">
          {toDecimalOdds(bet.combined.marketProb)}x
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium">
          {bet.legs.map((leg, i) => (
            <span key={`${leg.pickId}-${leg.outcomeLabel}`}>
              {i > 0 && <span className="text-text-faint"> + </span>}
              <span style={{ color: resultColor(legResults?.[i]) }}>{leg.outcomeLabel}</span>
            </span>
          ))}
        </p>
        <p className="truncate text-[10px] text-text-faint">
          {bet.legs.length > 1 ? `${bet.legs.length}-leg parlay` : bet.legs[0]?.title}
          {" · "}
          {formatEur(bet.stake)} &middot; {formatRelativeTime(bet.placedAt)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-display text-[13px] font-bold tabular-nums text-text">{formatEur(currentValue)}</p>
        <p
          className="text-[10px] font-medium tabular-nums"
          style={{ color: positive ? "var(--accent)" : negative ? "var(--accent-3)" : "var(--text-faint)" }}
        >
          {pnl >= 0 ? "+" : ""}
          {formatEur(pnl)} ({toSignedReturnPercent(pnlPct)})
        </p>
      </div>
    </div>
  );
}

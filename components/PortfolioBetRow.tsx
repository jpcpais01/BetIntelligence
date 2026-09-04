import type { PlacedBet } from "@/lib/placedBets";
import type { HistoryPoint } from "@/lib/oddsHistory";
import { computeBetValue } from "@/lib/portfolioHistory";
import { formatEur, formatRelativeTime, toSignedReturnPercent, toDecimalOdds } from "@/lib/format";
import { TicketIcon } from "./icons";

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
  const choice = bet.legs.map((l) => l.outcomeLabel).join(" + ");

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2">
        <TicketIcon className="h-4 w-4 text-text-faint" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-text">{choice}</p>
        <p className="truncate text-[10px] text-text-faint">
          {bet.legs.length > 1 ? `${bet.legs.length}-leg parlay` : bet.legs[0]?.title}
          {" · "}
          {toDecimalOdds(bet.combined.marketProb)}x &middot; {formatEur(bet.stake)} &middot; {formatRelativeTime(bet.placedAt)}
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

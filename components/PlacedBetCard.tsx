import type { PlacedBet } from "@/lib/placedBets";
import { combineSlip } from "@/lib/betslip";
import { liveKey } from "@/lib/livePrices";
import { toSignedPercent, toDecimalOdds, toPercent, formatRelativeTime } from "@/lib/format";
import { TicketIcon } from "./icons";

// A placed bet is a permanent paper-trade record, not a live position — the app has no way to
// know how a match or market actually resolved, so every entry just shows "Pending" rather than
// fabricating a win/loss. Odds and edge are repriced against the current market (same livePrices
// map Lab's build view uses). Styled like a ticket stub: a dashed divider separates "what you
// bought" from the live snapshot, same visual language real sportsbook confirmations use.
export default function PlacedBetCard({ bet, livePrices }: { bet: PlacedBet; livePrices: Record<string, number> }) {
  const { legs } = bet;
  const liveLegs = legs.map((leg) => ({
    ...leg,
    marketProb: livePrices[liveKey(leg.pickId, leg.outcomeLabel)] ?? leg.marketProb,
  }));
  const live = combineSlip(liveLegs);

  return (
    <div className="overflow-hidden rounded-3xl" style={{ background: "var(--lab-surface)", border: "1px solid var(--lab-border)" }}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--lab-gold)" }}>
          <TicketIcon className="h-3.5 w-3.5" />
          Placed
        </span>
        <span className="text-[10px] text-text-faint">{formatRelativeTime(bet.placedAt)}</span>
      </div>

      <div className="space-y-1.5 px-4">
        {legs.map((leg, i) => (
          <div key={leg.pickId} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="min-w-0 truncate text-text-dim">
              <span className="font-semibold text-text">{leg.outcomeLabel}</span> &middot; {leg.title}
            </span>
            <span className="shrink-0 tabular-nums text-text-faint">
              {toDecimalOdds(liveLegs[i].marketProb)}x{" "}
              <span className="text-[10px]">({toPercent(liveLegs[i].marketProb)})</span>
            </span>
          </div>
        ))}
      </div>

      <div className="mx-4 my-3 border-t border-dashed" style={{ borderColor: "var(--lab-border)" }} />

      <div className="flex items-center justify-between gap-2 px-4 pb-4">
        <div className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium text-text-faint" style={{ background: "var(--lab-surface-2)" }}>
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
          Pending
        </div>
        <div className="flex items-center gap-3 text-right">
          <div>
            <p className="text-[9px] text-text-faint">Odds now</p>
            <p className="flex items-baseline justify-end gap-1">
              <span className="font-display text-[13px] font-bold tabular-nums" style={{ color: "var(--lab-gold)" }}>
                {toDecimalOdds(live.marketProb)}x
              </span>
              <span className="text-[9px] font-medium tabular-nums text-text-faint">{toPercent(live.marketProb)}</span>
            </p>
          </div>
          <div>
            <p className="text-[9px] text-text-faint">Edge now</p>
            <p
              className="font-display text-[13px] font-bold tabular-nums"
              style={{ color: live.edge > 0.005 ? "var(--lab-green)" : live.edge < -0.005 ? "var(--lab-red)" : "var(--text)" }}
            >
              {toSignedPercent(live.edge)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

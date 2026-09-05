import type { PlacedBet } from "@/lib/placedBets";
import { combineSlip } from "@/lib/betslip";
import { liveKey } from "@/lib/livePrices";
import { toSignedPercent, toDecimalOdds, toPercent, toSignedReturnPercent, formatEur, formatRelativeTime } from "@/lib/format";
import { TicketIcon, CloseIcon } from "./icons";

// A placed bet is a paper-trade record. Once football-data.org confirms every football leg's
// match finished (lib/settlement.ts), it shows a real Won/Lost outcome and payout instead of
// "Pending" — a bet with any Discover/market leg has no resolution source and just stays Pending
// forever, same as before settlement existed. Odds/edge for a still-open bet are repriced against
// the current market (same livePrices map Lab's build view uses). Styled like a ticket stub: a
// dashed divider separates "what you bought" from the live snapshot/outcome, same visual language
// real sportsbook confirmations use.
export default function PlacedBetCard({
  bet,
  livePrices,
  onRemove,
}: {
  bet: PlacedBet;
  livePrices: Record<string, number>;
  onRemove: (id: string) => void;
}) {
  const { legs, settlement } = bet;
  const liveLegs = legs.map((leg) => ({
    ...leg,
    marketProb: livePrices[liveKey(leg.pickId, leg.outcomeLabel)] ?? leg.marketProb,
  }));
  const live = combineSlip(liveLegs);
  const pnl = settlement ? settlement.payout - bet.stake : 0;
  const pnlPct = bet.stake > 0 ? pnl / bet.stake : 0;

  return (
    <div className="overflow-hidden rounded-3xl" style={{ background: "var(--lab-surface)", border: "1px solid var(--lab-border)" }}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--lab-gold)" }}>
          <TicketIcon className="h-3.5 w-3.5" />
          Placed
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[10px] text-text-faint">{formatRelativeTime(bet.placedAt)}</span>
          <button
            onClick={() => onRemove(bet.id)}
            aria-label="Delete bet"
            className="press -mr-1 shrink-0 text-text-faint hover:text-[var(--lab-red)]"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
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
        <div
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium"
          style={{
            background: settlement ? "transparent" : "var(--lab-surface-2)",
            color: settlement?.status === "won" ? "var(--lab-green)" : settlement?.status === "lost" ? "var(--lab-red)" : "var(--text-faint)",
            boxShadow: settlement ? `inset 0 0 0 1px ${settlement.status === "won" ? "var(--lab-green)" : "var(--lab-red)"}` : "none",
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
          {settlement?.status === "won" ? "Won" : settlement?.status === "lost" ? "Lost" : "Pending"}
        </div>
        {settlement ? (
          <div className="flex items-center gap-3 text-right">
            <div>
              <p className="text-[9px] text-text-faint">Payout</p>
              <p className="font-display text-[13px] font-bold tabular-nums" style={{ color: "var(--lab-gold)" }}>
                {formatEur(settlement.payout)}
              </p>
            </div>
            <div>
              <p className="text-[9px] text-text-faint">P&amp;L</p>
              <p
                className="font-display text-[13px] font-bold tabular-nums"
                style={{ color: pnl > 0.005 ? "var(--lab-green)" : pnl < -0.005 ? "var(--lab-red)" : "var(--text)" }}
              >
                {pnl >= 0 ? "+" : ""}
                {formatEur(pnl)} ({toSignedReturnPercent(pnlPct)})
              </p>
            </div>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}

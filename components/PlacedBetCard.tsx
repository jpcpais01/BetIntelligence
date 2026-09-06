import type { PlacedBet } from "@/lib/placedBets";
import { toDecimalOdds, toPercent, toSignedReturnPercent, formatEur, formatRelativeTime } from "@/lib/format";
import { TicketIcon, CloseIcon } from "./icons";

// A placed bet is a paper-trade record. Once football-data.org confirms every football leg's
// match finished (lib/settlement.ts), it shows a real Won/Lost outcome and payout instead of
// "Pending" — a bet with any Discover/market leg has no resolution source and just stays Pending
// forever, same as before settlement existed. Every odd/edge shown here is frozen at the moment
// the bet was placed (leg.marketProb/leg.aiProb, bet.combined) — this used to reprice a still-open
// bet's odds against the live market instead, which read as confusing (an odd that keeps moving
// isn't "the odds you got"; it's just wherever the market happens to be right now). Styled like a
// ticket stub: a dashed divider separates "what you bought" from the outcome, same visual language
// real sportsbook confirmations use.
export default function PlacedBetCard({
  bet,
  onRemove,
}: {
  bet: PlacedBet;
  onRemove: (id: string) => void;
}) {
  const { legs, settlement, legResults } = bet;
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
        {legs.map((leg, i) => {
          const legResult = legResults?.[i];
          const legColor = legResult === "won" ? "var(--lab-green)" : legResult === "lost" ? "var(--lab-red)" : undefined;
          return (
            <div key={leg.pickId} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-text-dim">
                <span className="font-semibold" style={{ color: legColor ?? "var(--text)" }}>
                  {leg.outcomeLabel}
                </span>{" "}
                &middot; {leg.title}
              </span>
              <span className="shrink-0 text-right text-[10px] tabular-nums text-text-faint">
                <span style={{ color: "var(--lab-gold)" }}>
                  Mkt {toDecimalOdds(leg.marketProb)}x ({toPercent(leg.marketProb)})
                </span>
                <br />
                AI {toDecimalOdds(leg.aiProb)}x ({toPercent(leg.aiProb)})
              </span>
            </div>
          );
        })}
      </div>

      <div className="mx-4 my-3 border-t border-dashed" style={{ borderColor: "var(--lab-border)" }} />

      <div className="flex items-center justify-between gap-2 px-4 pb-4">
        <div className="flex flex-col items-start gap-1">
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
          <span className="pl-0.5 text-[10px] tabular-nums text-text-faint">Staked {formatEur(bet.stake)}</span>
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
              <p className="text-[9px] text-text-faint">Market</p>
              <p className="flex items-baseline justify-end gap-1">
                <span className="font-display text-[13px] font-bold tabular-nums" style={{ color: "var(--lab-gold)" }}>
                  {toDecimalOdds(bet.combined.marketProb)}x
                </span>
                <span className="text-[9px] font-medium tabular-nums text-text-faint">{toPercent(bet.combined.marketProb)}</span>
              </p>
            </div>
            <div>
              <p className="text-[9px] text-text-faint">Analysis</p>
              <p className="flex items-baseline justify-end gap-1">
                <span className="font-display text-[13px] font-bold tabular-nums text-text">
                  {toDecimalOdds(bet.combined.aiProb)}x
                </span>
                <span className="text-[9px] font-medium tabular-nums text-text-faint">{toPercent(bet.combined.aiProb)}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

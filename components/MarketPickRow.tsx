import type { SavedMarketPick } from "@/lib/types";
import { toPercent } from "@/lib/format";

export default function MarketPickRow({
  pick,
  selectedOutcomeLabel,
  onPick,
}: {
  pick: SavedMarketPick;
  selectedOutcomeLabel: string | null;
  onPick: (outcomeLabel: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-3.5">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] text-text-faint">
        <span>{pick.categoryEmoji}</span>
        <span className="truncate">{pick.category}</span>
      </div>

      <p className="mb-3 truncate text-[13px] font-medium">{pick.title}</p>

      <div className="flex flex-wrap gap-1.5">
        {pick.independent.outcomes.map((o) => {
          const marketPrice = pick.market.find((m) => m.label === o.label)?.price ?? 0;
          const active = selectedOutcomeLabel === o.label;
          return (
            <button
              key={o.label}
              onClick={() => onPick(o.label)}
              className={`press min-w-[72px] flex-1 rounded-xl px-2 py-2 text-center ring-1 ring-inset ${
                active ? "bg-surface-2 ring-2 ring-accent" : "bg-surface-2/60 ring-border-soft"
              }`}
            >
              <p className="truncate text-[10px] text-text-faint">{o.label}</p>
              <p className="font-display text-[14px] font-semibold tabular-nums text-accent">
                {toPercent(o.probability)}
              </p>
              <p className="text-[10px] tabular-nums text-text-faint">mkt {toPercent(marketPrice)}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

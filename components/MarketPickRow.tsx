import type { SavedMarketPick } from "@/lib/types";
import { liveKey } from "@/lib/livePrices";
import { toPercent, toSignedPercent, toDecimalOdds } from "@/lib/format";
import { ChevronRightIcon, BoltIcon } from "./icons";

const VALUE_EDGE_THRESHOLD = 0.02;
const OUTCOME_COLORS = ["var(--lab-gold)", "var(--lab-cyan)", "var(--lab-pink)", "#9b8cff", "#ff9f4d", "#5cc9ff"];

export default function MarketPickRow({
  pick,
  livePrices,
  selectedOutcomeLabel,
  onPick,
  onOpen,
}: {
  pick: SavedMarketPick;
  livePrices: Record<string, number>;
  selectedOutcomeLabel: string | null;
  onPick: (outcomeLabel: string) => void;
  onOpen: () => void;
}) {
  return (
    <div className="rounded-2xl p-2.5" style={{ background: "var(--lab-surface)", border: "1px solid var(--lab-border)" }}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-text-faint">
        <span>{pick.categoryEmoji}</span>
        <span className="truncate">{pick.category}</span>
      </div>

      <button onClick={onOpen} className="press mb-2 flex w-full items-center gap-1.5 text-left">
        <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-text">{pick.title}</p>
        <ChevronRightIcon className="h-3 w-3 shrink-0 text-text-faint" />
      </button>

      <div className="flex flex-wrap gap-1">
        {pick.independent.outcomes.map((o, i) => {
          const entryMarket = pick.market.find((m) => m.label === o.label)?.price ?? 0;
          const liveMarket = livePrices[liveKey(pick.id, o.label)] ?? entryMarket;
          const active = selectedOutcomeLabel === o.label;
          const edge = o.probability - liveMarket;
          const isValue = edge >= VALUE_EDGE_THRESHOLD;
          const color = OUTCOME_COLORS[i % OUTCOME_COLORS.length];
          return (
            <button
              key={o.label}
              onClick={() => onPick(o.label)}
              className="press relative min-w-[70px] flex-1 rounded-xl px-1.5 py-1.5 text-center"
              style={{
                background: active ? "var(--lab-surface-2)" : "rgba(255,255,255,0.03)",
                boxShadow: active ? `inset 0 0 0 1.5px ${color}` : "inset 0 0 0 1px var(--lab-border)",
              }}
            >
              {isValue && (
                <span
                  className="absolute -top-1 -right-1 flex items-center gap-0.5 rounded-full px-1 py-0.5 text-[7px] font-bold"
                  style={{ background: "var(--lab-green)", color: "#052018" }}
                >
                  <BoltIcon className="h-1.5 w-1.5" />
                  {toSignedPercent(edge)}
                </span>
              )}
              <p className="truncate text-[9px] text-text-faint">{o.label}</p>
              <p className="font-display text-[15px] font-bold tabular-nums" style={{ color }}>
                {toDecimalOdds(liveMarket)}
              </p>
              <p className="text-[8px] tabular-nums text-text-faint">AI {toPercent(o.probability)}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

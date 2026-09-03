import type { SavedMarketPick } from "@/lib/types";
import { formatEndDate, toSignedPercent } from "@/lib/format";
import { TrendingUpIcon, ScaleIcon, CloseIcon, ExternalLinkIcon } from "./icons";

export default function SavedMarketPickCard({
  pick,
  onRemove,
}: {
  pick: SavedMarketPick;
  onRemove: (id: string) => void;
}) {
  const bestEdge = pick.comparison.bestValue
    ? pick.comparison.edges.find((e) => e.label === pick.comparison.bestValue)
    : null;

  return (
    <div className="rise-in rounded-2xl border border-border-soft bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-faint">
          <span className="text-xs leading-none">{pick.categoryEmoji}</span>
          <span className="truncate">{pick.category}</span>
          <span className="opacity-50">&middot;</span>
          <span className="shrink-0">{formatEndDate(pick.endDate)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={pick.polymarketUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open on Polymarket"
            className="press rounded-full p-1.5 text-text-faint hover:bg-surface-2 hover:text-accent"
          >
            <ExternalLinkIcon className="h-3 w-3" />
          </a>
          <button
            onClick={() => onRemove(pick.id)}
            aria-label="Remove pick"
            className="press rounded-full p-1.5 text-text-faint hover:bg-surface-2 hover:text-accent-3"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </div>
      </div>

      <p className="mb-3.5 text-[13px] font-medium leading-snug">{pick.title}</p>

      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {pick.independent.outcomes.slice(0, 3).map((o) => {
          const marketPrice = pick.market.find((m) => m.label === o.label)?.price ?? 0;
          return (
            <div key={o.label} className="rounded-xl bg-surface-2 px-2 py-2 text-center">
              <p className="truncate text-[10px] text-text-faint">{o.label}</p>
              <p className="font-display text-[15px] font-semibold tabular-nums text-text">
                {Math.round(o.probability * 100)}%
              </p>
              <p className="text-[10px] tabular-nums text-text-faint">mkt {Math.round(marketPrice * 100)}%</p>
            </div>
          );
        })}
      </div>

      {bestEdge ? (
        <div className="flex items-center gap-2 rounded-xl bg-accent/8 px-3 py-2 ring-1 ring-inset ring-accent/20">
          <TrendingUpIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
          <p className="truncate text-[11px] text-text-dim">
            <span className="font-medium text-accent">{bestEdge.label}</span> &middot;{" "}
            <span className="tabular-nums">{toSignedPercent(bestEdge.edge)}</span> edge
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
          <ScaleIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          <p className="text-[11px] text-text-dim">Market looked efficient.</p>
        </div>
      )}
    </div>
  );
}

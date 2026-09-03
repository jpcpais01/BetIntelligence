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
    <div className="pop-in rounded-md border p-4" style={{ borderColor: "var(--d-border)", background: "var(--d-surface)" }}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] uppercase tracking-wide text-text-faint">
          <span>{pick.categoryEmoji}</span>
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
            className="press rounded-sm p-1.5 text-text-faint ring-1 ring-inset hover:text-text"
            style={{ borderColor: "var(--d-border)" }}
          >
            <ExternalLinkIcon className="h-3 w-3" />
          </a>
          <button
            onClick={() => onRemove(pick.id)}
            aria-label="Remove pick"
            className="press rounded-sm p-1.5 text-text-faint hover:bg-white/5"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </div>
      </div>

      <p className="mb-3 text-[13px] font-semibold leading-snug text-text">{pick.title}</p>

      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {pick.independent.outcomes.slice(0, 3).map((o) => {
          const marketPrice = pick.market.find((m) => m.label === o.label)?.price ?? 0;
          return (
            <div key={o.label} className="rounded-sm px-2 py-2 text-center" style={{ background: "var(--d-surface-2)" }}>
              <p className="truncate text-[10px] uppercase tracking-wide text-text-faint">{o.label}</p>
              <p className="glow-text font-display text-[15px] font-semibold tabular-nums" style={{ color: "var(--d-accent)" }}>
                {Math.round(o.probability * 100)}%
              </p>
              <p className="text-[10px] tabular-nums text-text-faint">mkt {Math.round(marketPrice * 100)}%</p>
            </div>
          );
        })}
      </div>

      {bestEdge ? (
        <div
          className="flex items-center gap-2 rounded-sm px-3 py-2 ring-1 ring-inset"
          style={{ background: "rgba(var(--d-accent-rgb), 0.08)", borderColor: "var(--d-accent)" }}
        >
          <TrendingUpIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--d-accent)" }} />
          <p className="truncate text-[11px] text-text-dim">
            <span className="font-medium" style={{ color: "var(--d-accent)" }}>
              {bestEdge.label}
            </span>{" "}
            &middot; <span className="tabular-nums">{toSignedPercent(bestEdge.edge)}</span> edge
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-sm px-3 py-2" style={{ background: "var(--d-surface-2)" }}>
          <ScaleIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          <p className="text-[11px] text-text-dim">Market looked efficient.</p>
        </div>
      )}
    </div>
  );
}

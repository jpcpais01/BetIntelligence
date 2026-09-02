import type { SavedPick } from "@/lib/types";
import { formatKickoff, toSignedPercent } from "@/lib/format";
import Avatar from "./Avatar";
import ConfidenceBadge from "./ConfidenceBadge";
import { TrendingUpIcon, ScaleIcon, CloseIcon } from "./icons";

export default function PickCard({ pick, onRemove }: { pick: SavedPick; onRemove: (id: string) => void }) {
  const { label: kickoffLabel } = formatKickoff(pick.startTime);
  const savedLabel = new Date(pick.savedAt).toLocaleDateString([], { day: "numeric", month: "short" });

  const bestEdge =
    pick.comparison.bestValue === "none"
      ? null
      : pick.comparison.bestValue === "home"
        ? pick.homeTeam
        : pick.comparison.bestValue === "away"
          ? pick.awayTeam
          : "Draw";

  const bestEdgeValue =
    pick.comparison.bestValue === "none" ? 0 : pick.comparison.edges[pick.comparison.bestValue];

  return (
    <div className="rise-in rounded-3xl border border-border-soft bg-surface/70 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-dim">
          <span>{pick.leagueFlag}</span>
          {pick.leagueName}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-faint">Saved {savedLabel}</span>
          <button
            onClick={() => onRemove(pick.id)}
            className="rounded-full p-1 text-text-faint hover:bg-surface-2 hover:text-accent-3"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <Avatar name={pick.homeTeam} size={26} />
        <span className="text-sm font-semibold">{pick.homeTeam}</span>
        <span className="text-xs text-text-faint">vs</span>
        <span className="text-sm font-semibold">{pick.awayTeam}</span>
        <Avatar name={pick.awayTeam} size={26} />
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <MiniStat label={pick.homeTeam.split(" ")[0]} market={pick.market.home} ai={pick.independent.home} />
        <MiniStat label="Draw" market={pick.market.draw} ai={pick.independent.draw} />
        <MiniStat label={pick.awayTeam.split(" ")[0]} market={pick.market.away} ai={pick.independent.away} />
      </div>

      {bestEdge ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2">
          <TrendingUpIcon className="h-4 w-4 shrink-0 text-accent" />
          <p className="text-xs text-text-dim">
            <strong className="text-accent">{bestEdge}</strong> flagged as value &middot;{" "}
            {toSignedPercent(bestEdgeValue)} edge
          </p>
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-border-soft bg-surface-2 px-3 py-2">
          <ScaleIcon className="h-4 w-4 shrink-0 text-text-faint" />
          <p className="text-xs text-text-dim">Market looked efficient on this one.</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <ConfidenceBadge level={pick.comparison.confidence} />
        <span className="text-[11px] text-text-faint">{kickoffLabel}</span>
      </div>
    </div>
  );
}

function MiniStat({ label, market, ai }: { label: string; market: number; ai: number }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-2">
      <p className="truncate text-[10px] font-semibold text-text-faint">{label}</p>
      <p className="font-display text-sm font-semibold text-text">{Math.round(ai * 100)}%</p>
      <p className="text-[10px] text-text-faint">mkt {Math.round(market * 100)}%</p>
    </div>
  );
}

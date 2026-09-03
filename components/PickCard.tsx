import type { SavedPick } from "@/lib/types";
import { formatKickoff, toSignedPercent } from "@/lib/format";
import Avatar from "./Avatar";
import { TrendingUpIcon, ScaleIcon, CloseIcon, ChevronRightIcon } from "./icons";

export default function PickCard({
  pick,
  onRemove,
  onOpen,
}: {
  pick: SavedPick;
  onRemove: (id: string) => void;
  onOpen: (pick: SavedPick) => void;
}) {
  const { label: kickoffLabel } = formatKickoff(pick.startTime);

  const bestEdgeLabel =
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
    <div
      onClick={() => onOpen(pick)}
      className="press rise-in cursor-pointer rounded-2xl border border-border-soft bg-surface p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-faint">
          <span className="text-xs leading-none">{pick.leagueFlag}</span>
          <span className="truncate">{pick.leagueName}</span>
          <span className="opacity-50">&middot;</span>
          <span className="shrink-0">{kickoffLabel}</span>
          {pick.research && pick.research.runCount > 1 && (
            <>
              <span className="opacity-50">&middot;</span>
              <span className="shrink-0 text-accent">{pick.research.runCount}&times; researched</span>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(pick.id);
            }}
            aria-label="Remove pick"
            className="press -mr-1 rounded-full p-1.5 text-text-faint hover:bg-surface-2 hover:text-accent-3"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
          <ChevronRightIcon className="h-3.5 w-3.5 text-text-faint" />
        </div>
      </div>

      <div className="mb-3.5 flex items-center gap-2">
        <Avatar name={pick.homeTeam} size={22} />
        <span className="truncate text-[13px] font-medium">{pick.homeTeam}</span>
        <span className="shrink-0 text-[11px] text-text-faint">v</span>
        <span className="truncate text-[13px] font-medium">{pick.awayTeam}</span>
        <Avatar name={pick.awayTeam} size={22} />
      </div>

      <div className="mb-3 grid grid-cols-3 gap-1.5">
        <MiniStat label={pick.homeTeam.split(" ")[0]} ai={pick.independent.home} market={pick.market.home} />
        <MiniStat label="Draw" ai={pick.independent.draw} market={pick.market.draw} />
        <MiniStat label={pick.awayTeam.split(" ")[0]} ai={pick.independent.away} market={pick.market.away} />
      </div>

      {bestEdgeLabel ? (
        <div className="flex items-center gap-2 rounded-xl bg-accent/8 px-3 py-2 ring-1 ring-inset ring-accent/20">
          <TrendingUpIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
          <p className="truncate text-[11px] text-text-dim">
            <span className="font-medium text-accent">{bestEdgeLabel}</span> &middot;{" "}
            <span className="tabular-nums">{toSignedPercent(bestEdgeValue)}</span> edge
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

function MiniStat({ label, ai, market }: { label: string; ai: number; market: number }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-2 text-center">
      <p className="truncate text-[10px] text-text-faint">{label}</p>
      <p className="font-display text-[15px] font-semibold tabular-nums text-text">
        {Math.round(ai * 100)}%
      </p>
      <p className="text-[10px] tabular-nums text-text-faint">mkt {Math.round(market * 100)}%</p>
    </div>
  );
}

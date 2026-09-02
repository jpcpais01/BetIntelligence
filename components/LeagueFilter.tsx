import { LEAGUES } from "@/lib/leagues";
import type { LeagueId } from "@/lib/types";
import { StarIcon } from "./icons";

export default function LeagueFilter({
  selected,
  onSelect,
  counts,
  topOnly,
  onToggleTop,
  topCount,
}: {
  selected: LeagueId | "all";
  onSelect: (id: LeagueId | "all") => void;
  counts: Record<string, number>;
  topOnly: boolean;
  onToggleTop: () => void;
  topCount: number;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <button
        onClick={onToggleTop}
        className={`shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${
          topOnly
            ? "border-warn/40 bg-warn/15 text-warn"
            : "border-border-soft bg-surface text-text-dim hover:text-text"
        }`}
      >
        <StarIcon className="h-3.5 w-3.5" filled={topOnly} />
        Top Games <span className="opacity-60">{topCount}</span>
      </button>

      <div className="my-1 w-px shrink-0 self-stretch bg-border-soft" />

      <Chip active={selected === "all"} onClick={() => onSelect("all")}>
        All <span className="opacity-60">{counts.all ?? 0}</span>
      </Chip>
      {LEAGUES.map((league) => {
        const count = counts[league.id] ?? 0;
        if (count === 0) return null;
        return (
          <Chip key={league.id} active={selected === league.id} onClick={() => onSelect(league.id)}>
            <span className="mr-1">{league.flag}</span>
            {league.shortName} <span className="opacity-60">{count}</span>
          </Chip>
        );
      })}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${
        active
          ? "border-accent/40 bg-accent/15 text-accent"
          : "border-border-soft bg-surface text-text-dim hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

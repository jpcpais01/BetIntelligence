import { LEAGUES } from "@/lib/leagues";
import type { LeagueId } from "@/lib/types";

export default function LeagueFilter({
  selected,
  onSelect,
  counts,
}: {
  selected: LeagueId | "all";
  onSelect: (id: LeagueId | "all") => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
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

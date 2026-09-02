import { LEAGUES } from "@/lib/leagues";
import type { LeagueId } from "@/lib/types";
import { StarIcon, CheckIcon } from "./icons";

export default function LeagueFilter({
  selected,
  onToggle,
  onClear,
  counts,
  topOnly,
  onToggleTop,
  topCount,
}: {
  selected: LeagueId[];
  onToggle: (id: LeagueId) => void;
  onClear: () => void;
  counts: Record<string, number>;
  topOnly: boolean;
  onToggleTop: () => void;
  topCount: number;
}) {
  const allActive = selected.length === 0;

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

      <button
        onClick={onClear}
        className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${
          allActive
            ? "border-accent/40 bg-accent/15 text-accent"
            : "border-border-soft bg-surface text-text-dim hover:text-text"
        }`}
      >
        All <span className="opacity-60">{counts.all ?? 0}</span>
      </button>

      {LEAGUES.map((league) => {
        const count = counts[league.id] ?? 0;
        if (count === 0) return null;
        const active = selected.includes(league.id);
        return (
          <button
            key={league.id}
            onClick={() => onToggle(league.id)}
            className={`shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${
              active
                ? "border-accent/40 bg-accent/15 text-accent"
                : "border-border-soft bg-surface text-text-dim hover:text-text"
            }`}
          >
            {active ? <CheckIcon className="h-3 w-3" /> : <span>{league.flag}</span>}
            {league.shortName} <span className="opacity-60">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

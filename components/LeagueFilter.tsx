import { LEAGUES } from "@/lib/leagues";
import type { LeagueId } from "@/lib/types";
import { StarIcon } from "./icons";

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
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <Chip active={topOnly} onClick={onToggleTop} tone="warn">
        <StarIcon className="h-3 w-3" filled={topOnly} />
        Top
        <Count value={topCount} />
      </Chip>

      <div className="my-1.5 w-px shrink-0 self-stretch bg-border-soft" />

      <Chip active={allActive} onClick={onClear}>
        All
        <Count value={counts.all ?? 0} />
      </Chip>

      {LEAGUES.map((league) => {
        const count = counts[league.id] ?? 0;
        if (count === 0) return null;
        return (
          <Chip
            key={league.id}
            active={selected.includes(league.id)}
            onClick={() => onToggle(league.id)}
          >
            <span className="text-[11px] leading-none">{league.flag}</span>
            {league.shortName}
            <Count value={count} />
          </Chip>
        );
      })}
    </div>
  );
}

function Count({ value }: { value: number }) {
  return <span className="tabular-nums opacity-45">{value}</span>;
}

function Chip({
  active,
  onClick,
  tone = "accent",
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: "accent" | "warn";
  children: React.ReactNode;
}) {
  const activeClass =
    tone === "warn"
      ? "bg-warn/12 text-warn ring-warn/25"
      : "bg-accent/12 text-accent ring-accent/25";

  return (
    <button
      onClick={onClick}
      className={`press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${
        active ? activeClass : "bg-surface text-text-dim ring-border-soft"
      }`}
    >
      {children}
    </button>
  );
}

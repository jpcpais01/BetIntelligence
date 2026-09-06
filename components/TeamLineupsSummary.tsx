import type { TeamLineup } from "@/lib/types";

// Confirmed starting XIs, once ESPN has posted them — same "just don't show it" contract as
// TeamInjuriesSummary: a match with nothing announced on either side yet renders nothing at all,
// since "not announced yet" is the normal state right up until fairly close to kickoff, not a
// failure worth calling out on every single card.
export default function TeamLineupsSummary({
  homeTeam,
  awayTeam,
  homeLineup,
  awayLineup,
}: {
  homeTeam: string;
  awayTeam: string;
  homeLineup?: TeamLineup | null;
  awayLineup?: TeamLineup | null;
}) {
  if (!homeLineup && !awayLineup) return null;

  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-4">
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-faint">Starting XI</p>
      <div className="grid grid-cols-2 gap-3">
        <LineupList teamName={homeTeam} lineup={homeLineup ?? null} />
        <LineupList teamName={awayTeam} lineup={awayLineup ?? null} />
      </div>
    </div>
  );
}

function LineupList({ teamName, lineup }: { teamName: string; lineup: TeamLineup | null }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5">
        <p className="truncate text-[12px] font-medium text-text">{teamName}</p>
        {lineup?.formation && <span className="shrink-0 text-[10px] tabular-nums text-text-faint">{lineup.formation}</span>}
      </div>
      {!lineup ? (
        <p className="text-[11px] text-text-faint">Not announced yet.</p>
      ) : (
        <ul className="space-y-1">
          {lineup.starters.map((p, i) => (
            <li key={i} className="truncate text-[11px] leading-snug text-text-dim">
              {p.position && <span className="mr-1.5 text-text-faint">{p.position}</span>}
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

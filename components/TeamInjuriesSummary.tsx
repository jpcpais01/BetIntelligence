import type { InjuredPlayer } from "@/lib/types";

// Currently-out players per team, with a reason when the source actually gave one — Big Balls
// Sports Data mostly only flags a player as unavailable with no reason/status field, so "detail"
// falls back to an honest "reported unavailable" rather than implying more was checked (see
// lib/bigBallsData.ts). Shared between the live analysis sheet and a saved pick's read-only view.
export default function TeamInjuriesSummary({
  homeTeam,
  awayTeam,
  homeInjuries,
  awayInjuries,
}: {
  homeTeam: string;
  awayTeam: string;
  homeInjuries?: InjuredPlayer[] | null;
  awayInjuries?: InjuredPlayer[] | null;
}) {
  // Both null/undefined together means the source had nothing usable for this match at all
  // (uncovered league, no key, fetch failure, or team-name resolution failing) — the two never
  // resolve independently (see fetchInjurySummary), so checking both is enough to know there's
  // nothing to render at all, matching TeamAssessmentSummary's own "just don't show it" fallback.
  if (!homeInjuries && !awayInjuries) return null;

  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-4">
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-faint">Injuries / out</p>
      <div className="grid grid-cols-2 gap-3">
        <InjuryList teamName={homeTeam} players={homeInjuries ?? []} />
        <InjuryList teamName={awayTeam} players={awayInjuries ?? []} />
      </div>
    </div>
  );
}

function InjuryList({ teamName, players }: { teamName: string; players: InjuredPlayer[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 truncate text-[12px] font-medium text-text">{teamName}</p>
      {players.length === 0 ? (
        <p className="text-[11px] text-text-faint">None reported.</p>
      ) : (
        <ul className="space-y-1.5">
          {players.map((p, i) => (
            <li key={i} className="text-[11px] leading-snug">
              <span className="font-medium text-text">{p.name}</span>
              <span className="block text-[10px] text-text-faint">{p.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

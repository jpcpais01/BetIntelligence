import type { TeamStanding } from "@/lib/types";

// League-table position, points, goals, and a compact last-5-match form strip per team — factual
// context feeding the independent read, not an AI opinion (see TeamAssessmentSummary for that).
// Shared between the live analysis sheet and a saved pick's read-only detail view.
export default function TeamStandingsSummary({
  homeTeam,
  awayTeam,
  homeStanding,
  awayStanding,
}: {
  homeTeam: string;
  awayTeam: string;
  homeStanding?: TeamStanding | null;
  awayStanding?: TeamStanding | null;
}) {
  // A pick saved before this existed won't have either field at all, and a match in an uncovered
  // league or a failed fetch resolves both to null — either way, nothing to show.
  if (!homeStanding && !awayStanding) return null;

  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-4">
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-faint">League standing</p>
      <div className="grid grid-cols-2 gap-3">
        <StandingCard teamName={homeTeam} standing={homeStanding} />
        <StandingCard teamName={awayTeam} standing={awayStanding} />
      </div>
    </div>
  );
}

function StandingCard({ teamName, standing }: { teamName: string; standing?: TeamStanding | null }) {
  if (!standing) {
    return (
      <div className="min-w-0 rounded-xl bg-surface-2 p-3">
        <p className="truncate text-[12px] font-medium text-text">{teamName}</p>
        <p className="mt-1.5 text-[11px] text-text-faint">Standing not available.</p>
      </div>
    );
  }

  const goalDiff = standing.goalsFor - standing.goalsAgainst;

  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-3">
      <p className="truncate text-[12px] font-medium text-text">{teamName}</p>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="font-display text-[18px] font-bold tabular-nums text-text">#{standing.position}</span>
        <span className="truncate text-[10px] text-text-faint">
          {standing.points} pts &middot; {standing.playedGames}pl
        </span>
      </div>
      <p className="mt-0.5 text-[10px] tabular-nums text-text-faint">
        {standing.goalsFor}-{standing.goalsAgainst} goals ({goalDiff >= 0 ? "+" : ""}
        {goalDiff} GD)
      </p>
      {standing.form.length > 0 && (
        <div className="mt-2 flex gap-1">
          {standing.form.map((r, i) => (
            <FormDot key={i} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function FormDot({ result }: { result: "W" | "D" | "L" | "?" }) {
  const tone =
    result === "W"
      ? "bg-accent/15 text-accent"
      : result === "L"
        ? "bg-accent-3/15 text-accent-3"
        : "bg-surface text-text-faint ring-1 ring-inset ring-border-soft";

  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${tone}`}>
      {result}
    </span>
  );
}

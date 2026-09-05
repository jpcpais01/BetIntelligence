import type { IndependentPrediction, TeamAssessment } from "@/lib/types";

// The independent read's case for each team (pros/cons) plus its overall summary — shared between
// the live analysis sheet and a saved pick's read-only detail view, so both render identically.
export default function TeamAssessmentSummary({
  homeTeam,
  awayTeam,
  independent,
}: {
  homeTeam: string;
  awayTeam: string;
  independent: IndependentPrediction;
}) {
  return (
    <>
      <TeamAssessmentCard teamName={homeTeam} assessment={independent.homeAssessment} />
      <TeamAssessmentCard teamName={awayTeam} assessment={independent.awayAssessment} />
      {independent.summary && (
        <div className="rounded-2xl border border-border-soft bg-surface p-4">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-faint">Summary</p>
          <p className="selectable text-[13px] leading-relaxed text-text-dim">{independent.summary}</p>
        </div>
      )}
    </>
  );
}

function TeamAssessmentCard({ teamName, assessment }: { teamName: string; assessment: TeamAssessment }) {
  if (assessment.pros.length === 0 && assessment.cons.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-4">
      <p className="mb-2.5 truncate text-[13px] font-semibold text-text">{teamName}</p>
      <div className="grid grid-cols-2 gap-3">
        <PointList label="Pros" items={assessment.pros} tone="pro" />
        <PointList label="Cons" items={assessment.cons} tone="con" />
      </div>
    </div>
  );
}

function PointList({ label, items, tone }: { label: string; items: string[]; tone: "pro" | "con" }) {
  const labelClass = tone === "pro" ? "text-accent" : "text-accent-3";
  const dotClass = tone === "pro" ? "bg-accent" : "bg-accent-3";

  return (
    <div className="min-w-0">
      <p className={`mb-1.5 text-[10px] font-semibold uppercase tracking-wide ${labelClass}`}>{label}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-text-faint">None noted.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[12px] leading-snug text-text-dim">
              <span className={`mt-[6px] h-1 w-1 shrink-0 rounded-full ${dotClass}`} />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

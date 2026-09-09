import { toSignedReturnPercent } from "@/lib/format";
import { ChartIcon } from "./icons";
import type { OverviewResult } from "@/lib/overview";

// The headline number: every resolved hypothetical bet across every tier and both strategies,
// combined into one running Edge Score — the same "if every analyzed game had been bet on its own,
// flat-staked, individually" read the tier grid below breaks down further. Mirrors EdgeScorePanel's
// own glow-num treatment (Home) so the two "how am I actually doing" panels in this app read as
// one family, not two different visual languages for the same kind of number.
export default function OverviewSummaryCard({ result }: { result: OverviewResult }) {
  const { overallScore, totalAnalyzed, totalResolved, totalPending } = result;
  const positive = overallScore !== null && overallScore > 1.005;
  const negative = overallScore !== null && overallScore < 0.995;
  const liftRgb = positive ? "var(--accent-rgb)" : negative ? "var(--accent-3-rgb)" : "155, 161, 172";
  const signedPct = overallScore !== null ? toSignedReturnPercent(overallScore - 1) : "—";

  return (
    <div
      className="surface-glow relative overflow-hidden rounded-3xl border border-border-soft p-5"
      style={{ ["--lift-rgb" as string]: liftRgb }}
    >
      <div className="ambient-glow" />
      <div className="relative">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
          <ChartIcon className="h-3.5 w-3.5" />
          Every analyzed game, hypothetically
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span
            className="glow-num font-display text-[40px] font-bold tabular-nums leading-none"
            style={{ color: positive ? "var(--accent)" : negative ? "var(--accent-3)" : "var(--text)" }}
          >
            {signedPct}
          </span>
          <span className="text-[11px] text-text-faint">vs. fair odds</span>
        </div>
        <p className="mt-1 text-[11px] text-text-faint">
          {overallScore !== null ? `${overallScore.toFixed(2)}× running · ` : ""}
          {totalResolved} resolved{totalPending > 0 ? ` · ${totalPending} pending` : ""}
        </p>
        <p className="mt-2.5 text-[11px] leading-relaxed text-text-faint">
          As if every one of the {totalAnalyzed} match{totalAnalyzed === 1 ? "" : "es"} you&rsquo;ve
          ever analyzed was bet on individually, flat-staked, the moment the AI called it — whether
          you actually placed anything on it or not.
        </p>
      </div>
    </div>
  );
}

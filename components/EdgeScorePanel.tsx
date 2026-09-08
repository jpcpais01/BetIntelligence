"use client";

import type { PlacedBet } from "@/lib/placedBets";
import { overallEdgeScore, edgeScoreByRiskLevel } from "@/lib/edgeScore";
import { riskModeLabel, riskModeColor, type RiskMode } from "@/lib/riskModes";
import { toSignedReturnPercent } from "@/lib/format";
import { ScaleIcon } from "./icons";

// The Edge Score: for every football leg that's actually resolved (won or lost, regardless of
// whether the parlay it was part of has), multiply the running product by 1/p on a win or (1-p)
// on a loss — the market's own fair-odds payout for a win, and how surprising the miss was for a
// loss. A market-following bettor's score drifts around 1 (break-even); a score durably above 1
// means real edge, not just a lucky streak. See lib/edgeScore.ts for the full reasoning.
export default function EdgeScorePanel({ bets }: { bets: PlacedBet[] }) {
  const byLevel = edgeScoreByRiskLevel(bets);
  const totalLegs = byLevel.reduce((n, b) => n + b.legCount, 0);
  const overall = overallEdgeScore(bets);

  if (totalLegs === 0) {
    return (
      <div className="surface-lift rounded-3xl border border-border-soft p-5">
        <PanelHeader />
        <p className="mt-3 text-[12px] leading-relaxed text-text-faint">
          Once a leg from a placed bet actually settles — win or lose — this fills in with how far
          ahead of fair market odds you&rsquo;re running, overall and by how risky each pick was.
        </p>
      </div>
    );
  }

  const positive = overall !== null && overall > 1.005;
  const negative = overall !== null && overall < 0.995;
  const liftRgb = positive ? "var(--accent-rgb)" : negative ? "var(--accent-3-rgb)" : "155, 161, 172";
  const signedPct = overall !== null ? toSignedReturnPercent(overall - 1) : "—";

  return (
    <div
      className="surface-glow relative overflow-hidden rounded-3xl border border-border-soft p-5"
      style={{ ["--lift-rgb" as string]: liftRgb }}
    >
      <div className="ambient-glow" />
      <div className="relative">
        <PanelHeader />

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
          {overall !== null ? `${overall.toFixed(2)}× running · ` : ""}
          {totalLegs} resolved leg{totalLegs === 1 ? "" : "s"}
        </p>

        <div className="mt-4 space-y-1.5">
          {byLevel.map((row) => (
            <CategoryRow key={row.level} level={row.level} score={row.score} legCount={row.legCount} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PanelHeader() {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
      <ScaleIcon className="h-3.5 w-3.5" />
      Edge score
    </div>
  );
}

function CategoryRow({
  level,
  score,
  legCount,
}: {
  level: RiskMode;
  score: number | null;
  legCount: number;
}) {
  const color = riskModeColor(level);
  // A bar length purely for visual texture — capped so one huge multiplier from a single lucky
  // leg can't stretch a bar off the edge of the card. Centered isn't meaningful here (this isn't
  // a 0-100% scale), it's just "more filled = further above the 1x/break-even line".
  const pct = score === null ? 0 : Math.max(4, Math.min(100, ((score - 0.5) / 1.5) * 100));

  return (
    <div className="flex items-center gap-2.5">
      <span className="w-14 shrink-0 text-[11px] font-medium text-text-dim">{riskModeLabel(level)}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        {score !== null && (
          <div
            className="grow-bar h-full rounded-full"
            style={{ width: `${pct}%`, background: color }}
          />
        )}
      </div>
      <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-text-faint">
        {legCount === 0 ? "no data" : `${legCount} leg${legCount === 1 ? "" : "s"}`}
      </span>
      <span
        className="w-12 shrink-0 text-right text-[11px] font-semibold tabular-nums"
        style={{ color: score === null ? "var(--text-faint)" : color }}
      >
        {score === null ? "—" : toSignedReturnPercent(score - 1)}
      </span>
    </div>
  );
}

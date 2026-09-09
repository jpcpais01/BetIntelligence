import { riskModeColor, riskModeLabel, isFavoriteOnlyMode, type RiskMode } from "@/lib/riskModes";
import { toSignedReturnPercent } from "@/lib/format";
import type { OverviewCell } from "@/lib/overview";

// One risk tier's row — its own thin colored border (the exact .risk-border-<tier> treatment
// GameCard's own rated cards use, app/globals.css) plus two side-by-side strategy cells, so the
// same "which tier/strategy is actually working" question this page exists to answer reads the
// same visual language wherever a risk tier shows up in the app.
export default function OverviewTierRow({ mode, straight, combo }: { mode: RiskMode; straight: OverviewCell; combo: OverviewCell }) {
  const color = riskModeColor(mode);

  return (
    <div className={`surface-lift risk-border-${mode} rounded-2xl border p-3.5`}>
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="text-[12px] font-bold uppercase tracking-wide" style={{ color }}>
          {riskModeLabel(mode)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StrategyCell label="1 / X / 2" cell={straight} />
        <StrategyCell
          label="1X / X2"
          cell={combo}
          naReason={isFavoriteOnlyMode(mode) ? "a combo can never be the favorite" : undefined}
        />
      </div>
    </div>
  );
}

// naReason is set only for Calm/Easy's combo cell — structurally, not just "no data yet": a
// double-chance leg is never counted as backing the match's own favorite (lib/riskModes.ts), and
// Calm/Easy are favorite-only tiers by design, so this cell can never have anything in it no
// matter how much history piles up. Shown as an explicit "not applicable" rather than the ordinary
// "no data" so it never reads as a bug waiting to be fixed by more analyses.
function StrategyCell({ label, cell, naReason }: { label: string; cell: OverviewCell; naReason?: string }) {
  if (naReason) {
    return (
      <div className="rounded-xl bg-surface-2/50 p-2.5">
        <p className="text-[10px] font-medium text-text-faint">{label}</p>
        <p className="mt-1.5 text-[10px] leading-snug text-text-faint/80">N/A — {naReason}</p>
      </div>
    );
  }

  const positive = cell.score !== null && cell.score > 1.005;
  const negative = cell.score !== null && cell.score < 0.995;
  const color = cell.score === null ? "var(--text-faint)" : positive ? "var(--accent)" : negative ? "var(--accent-3)" : "var(--text)";

  return (
    <div className="rounded-xl bg-surface-2 p-2.5">
      <p className="text-[10px] font-medium text-text-faint">{label}</p>
      <p className="mt-1 font-display text-[17px] font-bold tabular-nums" style={{ color }}>
        {cell.score === null ? "—" : toSignedReturnPercent(cell.score - 1)}
      </p>
      <p className="mt-0.5 truncate text-[10px] tabular-nums text-text-faint">
        {cell.resolvedCount === 0 ? "no data yet" : `${cell.resolvedCount} leg${cell.resolvedCount === 1 ? "" : "s"}`}
        {cell.pendingCount > 0 ? ` · +${cell.pendingCount} pending` : ""}
      </p>
    </div>
  );
}

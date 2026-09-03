import type { Market } from "@/lib/types";
import { formatCompactNumber, formatEndDate } from "@/lib/format";
import { FlameIcon, SparkleIcon } from "./icons";
import OutcomeMeter from "./OutcomeMeter";

const OUTCOME_COLORS = ["var(--d-accent)", "var(--d-accent-2)", "var(--d-violet)", "var(--d-accent-3)"];

export default function MarketCard({
  market,
  hot,
  onAnalyze,
  style,
}: {
  market: Market;
  hot?: boolean;
  onAnalyze: (market: Market) => void;
  style?: React.CSSProperties;
}) {
  const [top, ...rest] = market.outcomes;
  const isBinary = market.totalOutcomes === 2;
  const extraCount = market.totalOutcomes - market.outcomes.length;

  return (
    <div
      className={`pop-in relative overflow-hidden rounded-3xl border p-4 ${
        hot ? "glow-pulse border-[var(--d-accent)]/40" : "border-[var(--d-border)]"
      }`}
      style={{ background: "var(--d-surface)", ...style }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold text-text-dim"
          style={{ background: "var(--d-surface-2)" }}
        >
          <span>{market.categoryEmoji}</span>
          {market.category}
        </span>
        {hot && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold"
            style={{ background: "rgba(255,61,127,0.15)", color: "var(--d-accent)" }}
          >
            <FlameIcon className="h-3 w-3" />
            HOT
          </span>
        )}
      </div>

      <h3 className="mb-3.5 text-[14px] font-semibold leading-snug text-text">{market.title}</h3>

      <div className="mb-3.5 flex items-end gap-3">
        <div className="min-w-0">
          <p
            className="font-display text-[34px] font-bold leading-none tabular-nums"
            style={{ color: "var(--d-accent-2)" }}
          >
            {Math.round(top.price * 100)}
            <span className="text-lg">%</span>
          </p>
          <p className="mt-1 truncate text-[11px] font-medium text-text-faint">{top.label}</p>
        </div>
      </div>

      {isBinary ? (
        <div className="mb-3.5 h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--d-surface-2)" }}>
          <div
            className="grow-bar h-full rounded-full"
            style={{ width: `${top.price * 100}%`, background: "var(--d-accent-2)" }}
          />
        </div>
      ) : (
        <div className="mb-3.5 space-y-2">
          {rest.slice(0, 2).map((o, i) => (
            <OutcomeMeter key={o.label} label={o.label} pct={o.price} color={OUTCOME_COLORS[i + 1]} size="sm" />
          ))}
          {extraCount > 0 && (
            <p className="text-[10px] text-text-faint">+{extraCount} more outcome{extraCount === 1 ? "" : "s"}</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-[10px] text-text-faint">
          <span className="tabular-nums">${formatCompactNumber(market.volume)} vol</span>
          <span className="mx-1.5">&middot;</span>
          <span>{formatEndDate(market.endDate)}</span>
        </div>
        <button
          onClick={() => onAnalyze(market)}
          className="press inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[11px] font-bold text-bg"
          style={{ background: "linear-gradient(135deg, var(--d-accent), var(--d-violet))" }}
        >
          <SparkleIcon className="h-3.5 w-3.5" />
          Analyze
        </button>
      </div>
    </div>
  );
}

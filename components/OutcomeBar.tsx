import { toPercent } from "@/lib/format";

type OutcomeColor = "home" | "draw" | "away";

const COLOR_VAR: Record<OutcomeColor, string> = {
  home: "var(--home)",
  draw: "var(--draw)",
  away: "var(--away)",
};

export default function OutcomeBar({
  label,
  pct,
  color,
  size = "md",
  markerPct,
  markerLabel,
  delayMs = 0,
}: {
  label: string;
  pct: number;
  color: OutcomeColor;
  size?: "sm" | "md" | "lg";
  markerPct?: number;
  markerLabel?: string;
  delayMs?: number;
}) {
  const heightClass = size === "sm" ? "h-1" : size === "lg" ? "h-2" : "h-1.5";
  const labelClass = size === "lg" ? "text-sm" : "text-[13px]";
  const valueClass = size === "lg" ? "text-sm" : "text-[13px]";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`${labelClass} truncate text-text-dim`}>{label}</span>
        <span
          className={`${valueClass} shrink-0 font-display font-semibold tabular-nums`}
          style={{ color: COLOR_VAR[color] }}
        >
          {toPercent(pct)}
        </span>
      </div>
      <div className={`relative w-full overflow-hidden rounded-full bg-surface-2 ${heightClass}`}>
        <div
          className="grow-bar h-full rounded-full"
          style={{
            width: `${Math.min(pct, 1) * 100}%`,
            background: COLOR_VAR[color],
            opacity: 0.9,
            animationDelay: `${delayMs}ms`,
          }}
        />
        {markerPct !== undefined && (
          <div
            className="absolute top-1/2 h-[calc(100%+4px)] w-0.5 -translate-y-1/2 rounded-full bg-text"
            style={{ left: `calc(${Math.min(markerPct, 1) * 100}% - 1px)` }}
            title={markerLabel}
          />
        )}
      </div>
    </div>
  );
}

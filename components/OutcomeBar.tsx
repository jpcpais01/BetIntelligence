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
  const heightClass = size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2";
  const labelClass = size === "lg" ? "text-sm" : "text-xs";
  const valueClass = size === "lg" ? "text-base" : "text-sm";

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className={`${labelClass} font-medium text-text-dim truncate`}>{label}</span>
        <span
          className={`${valueClass} font-display font-semibold shrink-0`}
          style={{ color: COLOR_VAR[color] }}
        >
          {toPercent(pct)}
        </span>
      </div>
      <div className={`relative w-full rounded-full bg-surface-2 overflow-hidden ${heightClass}`}>
        <div
          className="grow-bar h-full rounded-full"
          style={{
            width: `${Math.min(pct, 1) * 100}%`,
            background: COLOR_VAR[color],
            animationDelay: `${delayMs}ms`,
          }}
        />
        {markerPct !== undefined && (
          <div
            className="absolute top-1/2 -translate-y-1/2 h-[calc(100%+6px)] w-[3px] rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
            style={{ left: `calc(${Math.min(markerPct, 1) * 100}% - 1.5px)` }}
            title={markerLabel}
          />
        )}
      </div>
    </div>
  );
}

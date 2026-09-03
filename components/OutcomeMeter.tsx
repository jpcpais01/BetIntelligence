import { toPercent } from "@/lib/format";

// Discover's generalized answer to OutcomeBar: any market can have 2 to a dozen-plus named
// outcomes, so color is a raw value here instead of a fixed home/draw/away enum.
export default function OutcomeMeter({
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
  color: string;
  size?: "sm" | "md" | "lg";
  markerPct?: number;
  markerLabel?: string;
  delayMs?: number;
}) {
  const heightClass = size === "sm" ? "h-1.5" : size === "lg" ? "h-2.5" : "h-2";
  const labelClass = size === "lg" ? "text-sm" : "text-[13px]";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`${labelClass} truncate font-medium text-text-dim`}>{label}</span>
        <span
          className={`${labelClass} shrink-0 font-display font-bold tabular-nums`}
          style={{ color }}
        >
          {toPercent(pct)}
        </span>
      </div>
      <div className={`relative w-full overflow-hidden rounded-full bg-surface-2 ${heightClass}`}>
        <div
          className="grow-bar h-full rounded-full"
          style={{
            width: `${Math.min(Math.max(pct, 0), 1) * 100}%`,
            background: color,
            animationDelay: `${delayMs}ms`,
          }}
        />
        {markerPct !== undefined && (
          <div
            className="absolute top-1/2 h-[calc(100%+4px)] w-0.5 -translate-y-1/2 rounded-full bg-text"
            style={{ left: `calc(${Math.min(Math.max(markerPct, 0), 1) * 100}% - 1px)` }}
            title={markerLabel}
          />
        )}
      </div>
    </div>
  );
}

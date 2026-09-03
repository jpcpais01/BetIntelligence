"use client";

import type { ComponentType } from "react";

// Replaces the old step-checklist card while an analysis is in flight: a centered pulsing radar
// orb, a single rotating status line instead of a full list, an elapsed timer, and — when more
// than one independent research run was requested — a row of progress pips. All requested runs
// fire at once (they're fully independent of each other), so the pips fill in as each one
// finishes rather than lighting up one at a time. Used by both AnalysisSheet (football) and
// MarketAnalysisSheet (Discover).
export default function ResearchOverlay({
  variant = "standard",
  icon: Icon,
  title,
  subtitle,
  stepLabel,
  elapsed,
  completedRuns,
  totalRuns,
}: {
  variant?: "standard" | "discover";
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  stepLabel: string;
  elapsed: number;
  completedRuns: number;
  totalRuns: number;
}) {
  const discover = variant === "discover";
  const ovRgb = discover ? "var(--d-accent-rgb)" : "var(--accent-rgb)";
  const accentColor = discover ? "var(--d-accent)" : "var(--accent)";

  return (
    <div
      className="flex flex-col items-center px-2 py-8 text-center"
      style={{ ["--ov-rgb" as string]: ovRgb }}
    >
      <div className="relative mb-6 flex h-24 w-24 shrink-0 items-center justify-center">
        <span className="research-orb-ring" />
        <span className="research-orb-ring" />
        <span className="research-orb-ring" />
        <div
          className="relative flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: `rgba(${ovRgb}, 0.16)`, color: accentColor }}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <p className="font-display text-[15px] font-semibold text-text">{title}</p>
      <p className="mt-1 max-w-[280px] text-xs leading-relaxed text-text-faint">{subtitle}</p>

      {totalRuns > 1 && (
        <div className="mt-4 flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalRuns }).map((_, i) => {
              const done = i < completedRuns;
              return (
                <span
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full ${done ? "" : "pulse-dot"}`}
                  style={{
                    background: done ? accentColor : discover ? "var(--d-border)" : "var(--border)",
                    opacity: done ? 1 : 0.7,
                  }}
                />
              );
            })}
          </div>
          <p className="text-[11px] font-medium text-text-faint">
            {completedRuns} of {totalRuns} runs done
          </p>
        </div>
      )}

      <div className="mt-5 flex min-h-[1.5rem] items-center gap-2 text-[12px] text-text-dim">
        <span key={stepLabel} className="rise-in">
          {stepLabel}
        </span>
      </div>

      <p
        className="mt-4 font-display text-[13px] tabular-nums"
        style={{ color: discover ? accentColor : "var(--text-faint)" }}
      >
        {formatElapsed(elapsed)}
      </p>

      <p className="mt-5 max-w-[260px] text-[11px] leading-relaxed text-text-faint">
        {totalRuns > 1
          ? "All runs research independently at the same time. You'll see the AI's own estimate first, then how it compares to the market."
          : "Deep research can take a while. You'll see the AI's own estimate first, then how it compares to the market."}
      </p>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

"use client";

import type { ComponentType } from "react";

// Replaces the old step-checklist card while an analysis is in flight: a centered pulsing radar
// orb, a single rotating status line instead of a full list, an elapsed timer, and — when more
// than one independent research run was requested — a row of progress pips showing which run is
// currently in flight. Used by both AnalysisSheet (football) and MarketAnalysisSheet (Discover).
export default function ResearchOverlay({
  variant = "standard",
  icon: Icon,
  title,
  subtitle,
  stepLabel,
  elapsed,
  runIndex,
  runCount,
}: {
  variant?: "standard" | "discover";
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  stepLabel: string;
  elapsed: number;
  runIndex: number;
  runCount: number;
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

      {runCount > 1 && (
        <div className="mt-4 flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: runCount }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === runIndex ? "pulse-dot w-4" : "w-1.5"}`}
                style={{
                  background: i <= runIndex ? accentColor : discover ? "var(--d-border)" : "var(--border)",
                  opacity: i < runIndex ? 0.5 : 1,
                }}
              />
            ))}
          </div>
          <p className="text-[11px] font-medium text-text-faint">
            Run {runIndex + 1} of {runCount}
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
        Deep research can take a while, more so with multiple runs. You&apos;ll see the AI&apos;s
        own estimate first, then how it compares to the market.
      </p>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

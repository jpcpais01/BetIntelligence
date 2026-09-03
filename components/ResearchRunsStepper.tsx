"use client";

import { useEffect, useState } from "react";
import {
  MIN_RESEARCH_RUNS,
  MAX_RESEARCH_RUNS,
  DEFAULT_RESEARCH_RUNS,
  loadResearchRuns,
  saveResearchRuns,
} from "@/lib/researchRuns";
import { ChevronRightIcon } from "./icons";

// A small stepper next to each card's Analyze button: how many independent research runs to
// fire before comparing against the market. One global preference (like the model choice) —
// bump it once and every Analyze button honors it until you change it back.
export default function ResearchRunsStepper({ variant = "standard" }: { variant?: "standard" | "discover" }) {
  const [runs, setRuns] = useState(DEFAULT_RESEARCH_RUNS);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR */
    setRuns(loadResearchRuns());
  }, []);

  const change = (delta: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setRuns((current) => {
      const next = Math.min(MAX_RESEARCH_RUNS, Math.max(MIN_RESEARCH_RUNS, current + delta));
      saveResearchRuns(next);
      return next;
    });
  };

  const discover = variant === "discover";
  const atMin = runs <= MIN_RESEARCH_RUNS;
  const atMax = runs >= MAX_RESEARCH_RUNS;

  return (
    <div
      className={
        discover
          ? "flex items-center gap-0.5 rounded-sm p-0.5 ring-1 ring-inset"
          : "flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5 ring-1 ring-inset ring-border-soft"
      }
      style={discover ? { background: "var(--d-surface-2)", borderColor: "var(--d-border)" } : undefined}
      title="How many times to independently research this before comparing to the market"
    >
      <button
        onClick={change(-1)}
        disabled={atMin}
        aria-label="Fewer research runs"
        className={`press rounded-full p-1 disabled:opacity-30 ${discover ? "" : "text-text-faint hover:text-text"}`}
        style={discover ? { color: "var(--d-accent)" } : undefined}
      >
        <ChevronRightIcon className="h-3 w-3 rotate-180" />
      </button>
      <span
        className={discover ? "w-5 text-center text-[10px] font-bold tabular-nums" : "w-5 text-center text-[11px] font-semibold tabular-nums text-text-dim"}
        style={discover ? { color: "var(--d-accent)" } : undefined}
      >
        {runs}&times;
      </span>
      <button
        onClick={change(1)}
        disabled={atMax}
        aria-label="More research runs"
        className={`press rounded-full p-1 disabled:opacity-30 ${discover ? "" : "text-text-faint hover:text-text"}`}
        style={discover ? { color: "var(--d-accent)" } : undefined}
      >
        <ChevronRightIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

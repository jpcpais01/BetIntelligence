"use client";

import { useCallback, useEffect, useState } from "react";
import { loadLastAnalyses } from "@/lib/lastAnalysis";
import { computeOverview, type OverviewResult } from "@/lib/overview";
import { allRiskModes } from "@/lib/riskModes";
import OverviewSummaryCard from "@/components/OverviewSummaryCard";
import OverviewTierRow from "@/components/OverviewTierRow";
import { ChartIcon, RefreshIcon } from "@/components/icons";

// Not a live-polling page like Home/Lab (nothing here is time-critical the way an open bet is) —
// just a fresh look at real match results every time this page is opened, plus a manual refresh
// for whoever wants to check again without leaving and coming back.
export default function OverviewPage() {
  const [result, setResult] = useState<OverviewResult | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const analyses = loadLastAnalyses();
      const next = await computeOverview(analyses);
      setResult(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- loading persisted local analysis history and grading it against real match results, unavailable during SSR */
    void refresh();
  }, [refresh]);

  const modes = allRiskModes();

  return (
    <div className="mx-auto max-w-md">
      <header className="safe-top sticky top-0 z-30 border-b border-border-soft bg-bg/85 px-4 pb-3 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[17px] font-bold tracking-tight">Overview</h1>
            <p className="text-[11px] text-text-faint">
              {loading ? "Grading every analyzed match..." : "Every class, every strategy, side by side"}
            </p>
          </div>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh"
            className="press shrink-0 rounded-full bg-surface p-2.5 text-text-dim ring-1 ring-inset ring-border-soft disabled:opacity-50"
          >
            <RefreshIcon className={`h-4 w-4 ${loading ? "spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="px-4 pt-4">
        {result === null ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton h-24 rounded-2xl" />
            ))}
          </div>
        ) : result.totalAnalyzed === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border-soft bg-surface px-5 py-14 text-center">
            <ChartIcon className="h-6 w-6 text-text-faint" />
            <p className="selectable text-[13px] leading-relaxed text-text-dim">
              Analyze a match on Sports to start building your class/strategy record — every
              analysis counts here the moment it&rsquo;s done, whether you place a bet on it or not.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <OverviewSummaryCard result={result} />

            <div>
              <p className="mb-2 mt-1 text-[10px] font-semibold uppercase tracking-wide text-text-faint">
                By class &amp; strategy
              </p>
              <div className="space-y-2">
                {modes.map((mode) => (
                  <OverviewTierRow
                    key={mode}
                    mode={mode}
                    straight={result.cells.find((c) => c.mode === mode && c.strategy === "straight")!}
                    combo={result.cells.find((c) => c.mode === mode && c.strategy === "combo")!}
                  />
                ))}
              </div>
            </div>

            <p className="px-1 pb-2 text-center text-[10px] leading-relaxed text-text-faint">
              1 / X / 2 bets each match&rsquo;s straight recommendation. 1X / X2 independently picks
              whichever double-chance combo has the better edge — never the same leg as the straight
              strategy, and never eligible for Calm/Easy (those two require backing the match&rsquo;s
              own favorite, which a combo definitionally isn&rsquo;t).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

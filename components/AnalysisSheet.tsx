"use client";

import { useEffect, useRef, useState } from "react";
import type { Game, IndependentPrediction, ComparisonResult, SourceCitation } from "@/lib/types";
import OutcomeBar from "./OutcomeBar";
import ConfidenceBadge from "./ConfidenceBadge";
import EdgeChip from "./EdgeChip";
import {
  CloseIcon,
  BrainIcon,
  ScaleIcon,
  BookmarkIcon,
  AlertIcon,
  TrendingUpIcon,
  GlobeIcon,
  RefreshIcon,
} from "./icons";
import { formatKickoff } from "@/lib/format";
import { savePick } from "@/lib/picks";
import { loadSelectedModel } from "@/lib/models";

type Stage = "predicting" | "comparing" | "compared" | "error";

// Shown while step 1 runs. These describe what the model was actually asked to research.
const RESEARCH_STEPS = [
  "Searching for recent form and results",
  "Checking injuries and suspensions",
  "Reading team news and probable lineups",
  "Reviewing head-to-head history",
  "Weighing home and away records",
  "Estimating outcome probabilities",
];

const COMPARE_STEPS = [
  "Reading Polymarket's implied odds",
  "Measuring the gap against its own estimate",
  "Judging whether the difference is real",
];

async function postJson<T>(url: string, body: unknown, errorLabel: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || errorLabel);
  return data as T;
}

export default function AnalysisSheet({ game, onClose }: { game: Game; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>("predicting");
  const [independent, setIndependent] = useState<IndependentPrediction | null>(null);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [saved, setSaved] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Each request is kicked off once and its promise cached on a ref, so React's dev-mode
  // double-invoked effect re-subscribes to the same in-flight call rather than paying for a
  // second web-search-backed prediction. Results are applied by whichever run is still live.
  const predictRef = useRef<Promise<IndependentPrediction> | null>(null);
  const compareRef = useRef<Promise<ComparisonResult> | null>(null);

  // Both steps run back to back on open. Step 1's result is rendered as soon as it lands,
  // then step 2 starts on its own and streams in underneath it — no tap needed in between.
  useEffect(() => {
    let cancelled = false;

    const model = loadSelectedModel();

    (async () => {
      try {
        predictRef.current ??= postJson<{ prediction: IndependentPrediction }>(
          "/api/analyze/predict",
          {
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            leagueName: game.leagueName,
            startTime: game.startTime,
            model,
          },
          "Analysis failed."
        ).then((d) => d.prediction);

        const prediction = await predictRef.current;
        if (cancelled) return;
        setIndependent(prediction);
        setStage("comparing");
        setStepIdx(0);

        compareRef.current ??= postJson<{ comparison: ComparisonResult }>(
          "/api/analyze/compare",
          {
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            leagueName: game.leagueName,
            independent: prediction,
            market: game.odds,
            model,
          },
          "Comparison failed."
        ).then((d) => d.comparison);

        const result = await compareRef.current;
        if (cancelled) return;
        setComparison(result);
        setStage("compared");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setStage("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [game, retryKey]);

  const running = stage === "predicting" || stage === "comparing";

  useEffect(() => {
    if (!running) return;
    const steps = stage === "comparing" ? COMPARE_STEPS : RESEARCH_STEPS;
    const id = setInterval(() => setStepIdx((i) => Math.min(i + 1, steps.length - 1)), 4000);
    return () => clearInterval(id);
  }, [running, stage]);

  // A real elapsed counter — these calls can take a while, and a silent spinner reads as broken.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const handleRetry = () => {
    predictRef.current = null;
    compareRef.current = null;
    setIndependent(null);
    setComparison(null);
    setError(null);
    setStepIdx(0);
    setElapsed(0);
    setStage("predicting");
    setRetryKey((k) => k + 1);
  };

  const handleSave = () => {
    if (!independent || !comparison) return;
    savePick({
      id: `${game.id}-${Date.now()}`,
      savedAt: new Date().toISOString(),
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      leagueName: game.leagueName,
      leagueFlag: game.leagueFlag,
      startTime: game.startTime,
      market: game.odds,
      independent,
      comparison,
    });
    setSaved(true);
  };

  const { label: kickoffLabel } = formatKickoff(game.startTime);
  const steps = stage === "comparing" ? COMPARE_STEPS : RESEARCH_STEPS;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="sheet-up relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-border-soft bg-bg-elevated sm:max-w-lg sm:rounded-3xl sm:border">
        <div className="shrink-0 border-b border-border-soft px-5 pb-3.5 pt-3">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
                <span>{game.leagueFlag}</span>
                <span className="truncate">
                  {game.leagueName} &middot; {kickoffLabel}
                </span>
              </div>
              <div className="truncate font-display text-[15px] font-semibold">
                {game.homeTeam} <span className="text-text-faint">v</span> {game.awayTeam}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="press -mr-1 shrink-0 rounded-full p-2 text-text-faint hover:bg-surface-2"
            >
              <CloseIcon className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {stage === "predicting" && (
            <ResearchPanel
              title="Researching the match"
              subtitle="Reading the web for form, team news and injuries — no market odds seen yet."
              steps={steps}
              activeIdx={stepIdx}
              elapsed={elapsed}
            />
          )}

          {stage === "error" && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertIcon className="h-7 w-7 text-accent-3" />
              <p className="selectable max-w-xs text-sm text-text-dim">{error}</p>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={handleRetry}
                  className="press inline-flex items-center gap-1.5 rounded-full bg-accent/12 px-4 py-2 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/25"
                >
                  <RefreshIcon className="h-3.5 w-3.5" />
                  Try again
                </button>
                <button
                  onClick={onClose}
                  className="press rounded-full bg-surface-2 px-4 py-2 text-xs font-semibold text-text-dim"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {(stage === "comparing" || stage === "compared") && independent && (
            <div className="rise-in space-y-4">
              <SectionHeader
                icon={BrainIcon}
                step={1}
                title="Independent read"
                subtitle="Formed before seeing any market odds"
              />

              <div className="space-y-3.5 rounded-2xl border border-border-soft bg-surface p-4">
                <OutcomeBar label={game.homeTeam} pct={independent.home} color="home" size="lg" />
                <OutcomeBar label="Draw" pct={independent.draw} color="draw" size="lg" />
                <OutcomeBar label={game.awayTeam} pct={independent.away} color="away" size="lg" />
              </div>

              <ConfidenceBadge level={independent.confidence} />

              {independent.keyFactors.length > 0 && (
                <ul className="selectable space-y-2">
                  {independent.keyFactors.map((f, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-text-dim">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                      {f}
                    </li>
                  ))}
                </ul>
              )}

              {independent.rationale && (
                <p className="selectable text-[13px] leading-relaxed text-text-dim">
                  {independent.rationale}
                </p>
              )}

              <SourceList sources={independent.sources ?? []} />
            </div>
          )}

          {stage === "comparing" && (
            <div className="rise-in mt-5 rounded-2xl border border-border-soft bg-surface p-4">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-text">Comparing against the market</p>
                <span className="shrink-0 font-display text-[11px] tabular-nums text-text-faint">
                  {formatElapsed(elapsed)}
                </span>
              </div>
              <StepList steps={COMPARE_STEPS} activeIdx={stepIdx} />
            </div>
          )}

          {stage === "compared" && comparison && independent && (
            <div className="rise-in mt-6 space-y-4">
              <SectionHeader
                icon={ScaleIcon}
                step={2}
                title="Market comparison"
                subtitle="Polymarket odds revealed"
              />

              <div className="space-y-3.5 rounded-2xl border border-border-soft bg-surface p-4">
                <OutcomeBar
                  label={game.homeTeam}
                  pct={game.odds.home}
                  color="home"
                  markerPct={independent.home}
                  markerLabel="AI estimate"
                />
                <OutcomeBar
                  label="Draw"
                  pct={game.odds.draw}
                  color="draw"
                  markerPct={independent.draw}
                  markerLabel="AI estimate"
                />
                <OutcomeBar
                  label={game.awayTeam}
                  pct={game.odds.away}
                  color="away"
                  markerPct={independent.away}
                  markerLabel="AI estimate"
                />
                <p className="pt-0.5 text-[11px] text-text-faint">
                  Bars show the market. The line marks the AI&apos;s own estimate.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <EdgeChip label={firstWord(game.homeTeam)} edge={comparison.edges.home} />
                <EdgeChip label="Draw" edge={comparison.edges.draw} />
                <EdgeChip label={firstWord(game.awayTeam)} edge={comparison.edges.away} />
              </div>

              {comparison.bestValue !== "none" ? (
                <div className="flex items-start gap-2.5 rounded-2xl bg-accent/8 p-3.5 ring-1 ring-inset ring-accent/25">
                  <TrendingUpIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <div>
                    <p className="text-[13px] font-semibold text-accent">Possible value</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-dim">
                      The AI rates{" "}
                      <strong className="font-medium text-text">
                        {comparison.bestValue === "draw"
                          ? "the draw"
                          : comparison.bestValue === "home"
                            ? game.homeTeam
                            : game.awayTeam}
                      </strong>{" "}
                      higher than the market does.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2.5 rounded-2xl border border-border-soft bg-surface p-3.5">
                  <ScaleIcon className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" />
                  <div>
                    <p className="text-[13px] font-semibold text-text">Market looks efficient</p>
                    <p className="mt-0.5 text-xs text-text-dim">No meaningful edge on this one.</p>
                  </div>
                </div>
              )}

              <ConfidenceBadge level={comparison.confidence} />

              {comparison.verdict && (
                <p className="selectable text-[13px] leading-relaxed text-text-dim">
                  {comparison.verdict}
                </p>
              )}

              <button
                onClick={handleSave}
                disabled={saved}
                className="press flex w-full items-center justify-center gap-2 rounded-2xl border border-border-soft bg-surface py-3.5 text-[13px] font-semibold text-text disabled:opacity-60"
              >
                <BookmarkIcon className="h-4 w-4" filled={saved} />
                {saved ? "Saved to Picks" : "Save paper pick"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function firstWord(name: string): string {
  return name.split(" ")[0];
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ResearchPanel({
  title,
  subtitle,
  steps,
  activeIdx,
  elapsed,
}: {
  title: string;
  subtitle: string;
  steps: string[];
  activeIdx: number;
  elapsed: number;
}) {
  return (
    <div className="py-2">
      <div className="mb-4 flex items-start gap-3">
        <div className="breathe flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
          <GlobeIcon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-text">{title}</p>
            <span className="shrink-0 font-display text-[11px] tabular-nums text-text-faint">
              {formatElapsed(elapsed)}
            </span>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-text-faint">{subtitle}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border-soft bg-surface p-4">
        <StepList steps={steps} activeIdx={activeIdx} />
      </div>

      <p className="mt-3 px-1 text-[11px] leading-relaxed text-text-faint">
        Deep research can take up to a minute. You&apos;ll see the AI&apos;s own estimate first,
        then how it compares to the market.
      </p>
    </div>
  );
}

function StepList({ steps, activeIdx }: { steps: string[]; activeIdx: number }) {
  return (
    <ul className="space-y-2.5">
      {steps.map((step, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <li
            key={step}
            className={`flex items-center gap-2.5 text-[13px] ${
              active ? "text-text" : done ? "text-text-faint" : "text-text-faint/50"
            }`}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                done ? "bg-accent/15 text-accent" : active ? "bg-accent/15" : "bg-surface-2"
              }`}
            >
              {done ? (
                <svg viewBox="0 0 24 24" fill="none" className="h-2.5 w-2.5">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : active ? (
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
              ) : (
                <span className="h-1 w-1 rounded-full bg-text-faint/40" />
              )}
            </span>
            {step}
          </li>
        );
      })}
    </ul>
  );
}

function SourceList({ sources }: { sources: SourceCitation[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-3.5">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-text-faint">
        <GlobeIcon className="h-3 w-3" />
        {sources.length} source{sources.length === 1 ? "" : "s"} consulted
      </p>
      <ul className="space-y-1.5">
        {sources.map((s) => (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-xs text-text-dim underline-offset-2 hover:text-accent hover:underline"
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  step,
  title,
  subtitle,
}: {
  icon: (props: { className?: string }) => React.ReactElement;
  step: number;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text-dim">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-text-faint">
            {step}/2
          </span>
          <p className="truncate text-[13px] font-semibold text-text">{title}</p>
        </div>
        <p className="text-[11px] text-text-faint">{subtitle}</p>
      </div>
    </div>
  );
}

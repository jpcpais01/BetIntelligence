"use client";

import { useEffect, useRef, useState } from "react";
import type { Game, IndependentPrediction, ComparisonResult } from "@/lib/types";
import OutcomeBar from "./OutcomeBar";
import ConfidenceBadge from "./ConfidenceBadge";
import EdgeChip from "./EdgeChip";
import { CloseIcon, BrainIcon, ScaleIcon, SparkleIcon, BookmarkIcon, AlertIcon, TrendingUpIcon } from "./icons";
import { formatKickoff } from "@/lib/format";
import { savePick } from "@/lib/picks";

type Stage = "predicting" | "comparing" | "compared" | "error";

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

const RESEARCH_MESSAGES = [
  "Scanning recent form...",
  "Checking injury & suspension news...",
  "Reviewing head-to-head history...",
  "Assessing squad strength...",
  "Weighing home and away splits...",
];

const COMPARE_MESSAGES = [
  "Pulling Polymarket implied odds...",
  "Comparing against the independent read...",
  "Checking for pricing gaps...",
];

export default function AnalysisSheet({ game, onClose }: { game: Game; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>("predicting");
  const [independent, setIndependent] = useState<IndependentPrediction | null>(null);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messageIdx, setMessageIdx] = useState(0);
  const [saved, setSaved] = useState(false);

  // Each request is kicked off once and its promise cached on a ref, so React's dev-mode
  // double-invoked effect re-subscribes to the same in-flight call rather than paying for a
  // second web-search-backed prediction. Results are applied by whichever run is still live.
  const predictRef = useRef<Promise<IndependentPrediction> | null>(null);
  const compareRef = useRef<Promise<ComparisonResult> | null>(null);

  // Both steps run back to back on open. Step 1's result is rendered as soon as it lands,
  // then step 2 starts on its own and streams in underneath it — no tap needed in between.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        predictRef.current ??= postJson<{ prediction: IndependentPrediction }>(
          "/api/analyze/predict",
          {
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            leagueName: game.leagueName,
            startTime: game.startTime,
          },
          "Analysis failed."
        ).then((d) => d.prediction);

        const prediction = await predictRef.current;
        if (cancelled) return;
        setIndependent(prediction);
        setStage("comparing");
        setMessageIdx(0);

        compareRef.current ??= postJson<{ comparison: ComparisonResult }>(
          "/api/analyze/compare",
          {
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            leagueName: game.leagueName,
            independent: prediction,
            market: game.odds,
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
  }, [game]);

  useEffect(() => {
    if (stage !== "predicting" && stage !== "comparing") return;
    const id = setInterval(() => setMessageIdx((i) => i + 1), 1500);
    return () => clearInterval(id);
  }, [stage]);

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
  const messages = stage === "comparing" ? COMPARE_MESSAGES : RESEARCH_MESSAGES;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="sheet-up relative max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl border border-border-soft bg-bg-elevated shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border-soft bg-bg-elevated/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-faint">
              <span>{game.leagueFlag}</span>
              {game.leagueName} &middot; {kickoffLabel}
            </div>
            <div className="truncate font-display text-base font-semibold">
              {game.homeTeam} <span className="text-text-faint">vs</span> {game.awayTeam}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-2 text-text-faint hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-6">
          {stage === "predicting" && (
            <LoadingState message={messages[messageIdx % messages.length]} />
          )}

          {stage === "error" && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertIcon className="h-8 w-8 text-accent-3" />
              <p className="max-w-xs text-sm text-text-dim">{error}</p>
              <button
                onClick={onClose}
                className="mt-2 rounded-full bg-surface-2 px-4 py-2 text-xs font-semibold text-text"
              >
                Close
              </button>
            </div>
          )}

          {(stage === "comparing" || stage === "compared") && independent && (
            <div className="rise-in space-y-5">
              <SectionHeader
                icon={BrainIcon}
                step={1}
                title="Independent AI Read"
                subtitle="Made before seeing any market odds"
              />
              <div className="space-y-4 rounded-2xl border border-border-soft bg-surface/60 p-4">
                <OutcomeBar label={game.homeTeam} pct={independent.home} color="home" size="lg" />
                <OutcomeBar label="Draw" pct={independent.draw} color="draw" size="lg" />
                <OutcomeBar label={game.awayTeam} pct={independent.away} color="away" size="lg" />
              </div>
              <ConfidenceBadge level={independent.confidence} />
              {independent.keyFactors.length > 0 && (
                <ul className="space-y-2">
                  {independent.keyFactors.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-dim">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                      {f}
                    </li>
                  ))}
                </ul>
              )}
              {independent.rationale && (
                <p className="text-sm leading-relaxed text-text-dim">{independent.rationale}</p>
              )}
            </div>
          )}

          {stage === "comparing" && (
            <div className="rise-in mt-6 flex items-center gap-3 rounded-2xl border border-border-soft bg-surface/60 px-4 py-4">
              <span className="pulse-dot h-2 w-2 shrink-0 rounded-full bg-accent-2" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text">Revealing market odds...</p>
                <p className="mt-0.5 truncate text-xs text-text-faint">
                  {messages[messageIdx % messages.length]}
                </p>
              </div>
            </div>
          )}

          {stage === "compared" && comparison && independent && (
            <div className="rise-in mt-6 space-y-5">
              <SectionHeader
                icon={ScaleIcon}
                step={2}
                title="Market Comparison"
                subtitle="Polymarket odds revealed"
              />

              <div className="space-y-4 rounded-2xl border border-border-soft bg-surface/60 p-4">
                <OutcomeBar
                  label={`${game.homeTeam} (market)`}
                  pct={game.odds.home}
                  color="home"
                  size="md"
                  markerPct={independent.home}
                  markerLabel="AI estimate"
                />
                <OutcomeBar
                  label="Draw (market)"
                  pct={game.odds.draw}
                  color="draw"
                  size="md"
                  markerPct={independent.draw}
                  markerLabel="AI estimate"
                />
                <OutcomeBar
                  label={`${game.awayTeam} (market)`}
                  pct={game.odds.away}
                  color="away"
                  size="md"
                  markerPct={independent.away}
                  markerLabel="AI estimate"
                />
                <p className="text-[11px] text-text-faint">White line marks the AI&apos;s independent estimate.</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <EdgeChip label={game.homeTeam.split(" ")[0]} edge={comparison.edges.home} />
                <EdgeChip label="Draw" edge={comparison.edges.draw} />
                <EdgeChip label={game.awayTeam.split(" ")[0]} edge={comparison.edges.away} />
              </div>

              {comparison.bestValue !== "none" ? (
                <div className="glow-pulse flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/10 p-4">
                  <TrendingUpIcon className="h-5 w-5 shrink-0 text-accent" />
                  <div>
                    <p className="text-sm font-semibold text-accent">Value spotted</p>
                    <p className="mt-0.5 text-xs text-text-dim">
                      The AI thinks{" "}
                      <strong className="text-text">
                        {comparison.bestValue === "draw"
                          ? "the draw"
                          : comparison.bestValue === "home"
                            ? game.homeTeam
                            : game.awayTeam}
                      </strong>{" "}
                      may be mispriced by the market.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-2xl border border-border-soft bg-surface/60 p-4">
                  <ScaleIcon className="h-5 w-5 shrink-0 text-text-faint" />
                  <div>
                    <p className="text-sm font-semibold text-text">Market looks efficient</p>
                    <p className="mt-0.5 text-xs text-text-dim">No meaningful edge found on this one.</p>
                  </div>
                </div>
              )}

              <ConfidenceBadge level={comparison.confidence} />

              {comparison.verdict && (
                <p className="text-sm leading-relaxed text-text-dim">{comparison.verdict}</p>
              )}

              <button
                onClick={handleSave}
                disabled={saved}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border-soft bg-surface-2 px-4 py-3.5 text-sm font-semibold text-text transition active:scale-[0.98] disabled:opacity-60"
              >
                <BookmarkIcon className="h-4 w-4" filled={saved} />
                {saved ? "Saved to My Picks" : "Save Paper Pick"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-5 py-14 text-center">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="glow-pulse absolute inset-0 rounded-full bg-accent/20 blur-xl" />
        <SparkleIcon className="sparkle-spin h-9 w-9 text-accent" />
      </div>
      <div>
        <p className="font-display text-sm font-semibold text-text">Thinking it through...</p>
        <p className="mt-1 text-xs text-text-faint">{message}</p>
      </div>
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
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-2 text-accent">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-text-faint">
            STEP {step}
          </span>
          <p className="truncate text-sm font-semibold text-text">{title}</p>
        </div>
        <p className="text-[11px] text-text-faint">{subtitle}</p>
      </div>
    </div>
  );
}

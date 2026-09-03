"use client";

import { useEffect, useRef, useState } from "react";
import type { Market, MarketPrediction, MarketComparison, SourceCitation, Confidence } from "@/lib/types";
import OutcomeMeter from "./OutcomeMeter";
import {
  CloseIcon,
  BrainIcon,
  ScaleIcon,
  BookmarkIcon,
  AlertIcon,
  TrendingUpIcon,
  GlobeIcon,
  RefreshIcon,
  ExternalLinkIcon,
} from "./icons";
import { formatEndDate, toSignedPercent } from "@/lib/format";
import { saveMarketPick } from "@/lib/marketPicks";

type Stage = "predicting" | "comparing" | "compared" | "error";

const RESEARCH_STEPS = [
  "Searching recent news and coverage",
  "Checking historical base rates",
  "Weighing expert analysis and forecasts",
  "Cross-checking conflicting reports",
  "Estimating outcome probabilities",
];

const COMPARE_STEPS = [
  "Reading Polymarket's implied odds",
  "Measuring the gap against its own estimate",
  "Judging whether the difference is real",
];

const OUTCOME_COLORS = ["var(--d-accent)", "var(--d-violet)", "var(--d-accent-2)", "#8f9dff", "#ff8a5c", "#5cc9ff"];
const colorFor = (i: number) => OUTCOME_COLORS[i % OUTCOME_COLORS.length];

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

export default function MarketAnalysisSheet({ market, onClose }: { market: Market; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>("predicting");
  const [independent, setIndependent] = useState<MarketPrediction | null>(null);
  const [comparison, setComparison] = useState<MarketComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [saved, setSaved] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const predictRef = useRef<Promise<MarketPrediction> | null>(null);
  const compareRef = useRef<Promise<MarketComparison> | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        predictRef.current ??= postJson<{ prediction: MarketPrediction }>(
          "/api/analyze/market/predict",
          {
            title: market.title,
            category: market.category,
            endDate: market.endDate,
            outcomeLabels: market.outcomes.map((o) => o.label),
          },
          "Analysis failed."
        ).then((d) => d.prediction);

        const prediction = await predictRef.current;
        if (cancelled) return;
        setIndependent(prediction);
        setStage("comparing");
        setStepIdx(0);

        compareRef.current ??= postJson<{ comparison: MarketComparison }>(
          "/api/analyze/market/compare",
          {
            title: market.title,
            category: market.category,
            independent: prediction,
            market: market.outcomes,
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
  }, [market, retryKey]);

  const running = stage === "predicting" || stage === "comparing";

  useEffect(() => {
    if (!running) return;
    const steps = stage === "comparing" ? COMPARE_STEPS : RESEARCH_STEPS;
    const id = setInterval(() => setStepIdx((i) => Math.min(i + 1, steps.length - 1)), 4000);
    return () => clearInterval(id);
  }, [running, stage]);

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
    saveMarketPick({
      id: `${market.id}-${Date.now()}`,
      savedAt: new Date().toISOString(),
      title: market.title,
      category: market.category,
      categoryEmoji: market.categoryEmoji,
      endDate: market.endDate,
      polymarketUrl: market.polymarketUrl,
      market: market.outcomes,
      independent,
      comparison,
    });
    setSaved(true);
  };

  const steps = stage === "comparing" ? COMPARE_STEPS : RESEARCH_STEPS;

  return (
    <div className="discover fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="sheet-up relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg border-t sm:max-w-lg sm:rounded-lg sm:border"
        style={{ background: "var(--d-surface)", borderColor: "var(--d-border)" }}
      >
        <div className="shrink-0 border-b px-5 pb-3.5 pt-3" style={{ borderColor: "var(--d-border)" }}>
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-faint">
                <span>{market.categoryEmoji}</span>
                <span className="truncate">
                  {market.category} &middot; {formatEndDate(market.endDate)}
                </span>
              </div>
              <div className="truncate text-[15px] font-semibold text-text">{market.title}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <a
                href={market.polymarketUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open on Polymarket"
                className="press rounded-sm p-2 text-text-faint ring-1 ring-inset hover:text-text"
                style={{ borderColor: "var(--d-border)" }}
              >
                <ExternalLinkIcon className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={onClose}
                aria-label="Close"
                className="press rounded-sm p-2 text-text-faint hover:bg-white/5"
              >
                <CloseIcon className="h-4.5 w-4.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {stage === "predicting" && (
            <ResearchPanel
              title="Researching this market"
              subtitle="Reading the web for news, data and expert takes — no market odds seen yet."
              steps={steps}
              activeIdx={stepIdx}
              elapsed={elapsed}
            />
          )}

          {stage === "error" && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertIcon className="h-7 w-7" style={{ color: "var(--d-accent-2)" }} />
              <p className="selectable max-w-xs text-sm text-text-dim">{error}</p>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={handleRetry}
                  className="press inline-flex items-center gap-1.5 rounded-sm px-4 py-2 text-xs font-semibold"
                  style={{ background: "rgba(var(--d-accent-2-rgb), 0.12)", color: "var(--d-accent-2)" }}
                >
                  <RefreshIcon className="h-3.5 w-3.5" />
                  Try again
                </button>
                <button
                  onClick={onClose}
                  className="press rounded-sm px-4 py-2 text-xs font-semibold text-text-dim"
                  style={{ background: "var(--d-surface-2)" }}
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {(stage === "comparing" || stage === "compared") && independent && (
            <div className="rise-in space-y-4">
              <SectionHeader icon={BrainIcon} step={1} title="Independent read" subtitle="Formed before seeing any market odds" />

              <div className="space-y-3.5 rounded-md border p-4" style={{ borderColor: "var(--d-border)", background: "var(--d-surface-2)" }}>
                {independent.outcomes.map((o, i) => (
                  <OutcomeMeter key={o.label} label={o.label} pct={o.probability} color={colorFor(i)} size="lg" />
                ))}
              </div>

              <DiscoverConfidence level={independent.confidence} />

              {independent.keyFactors.length > 0 && (
                <ul className="selectable space-y-2">
                  {independent.keyFactors.map((f, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-text-dim">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--d-accent-2)" }} />
                      {f}
                    </li>
                  ))}
                </ul>
              )}

              {independent.rationale && (
                <p className="selectable text-[13px] leading-relaxed text-text-dim">{independent.rationale}</p>
              )}

              <SourceList sources={independent.sources ?? []} />
            </div>
          )}

          {stage === "comparing" && (
            <div className="rise-in mt-5 rounded-md border p-4" style={{ borderColor: "var(--d-border)", background: "var(--d-surface-2)" }}>
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
              <SectionHeader icon={ScaleIcon} step={2} title="Market comparison" subtitle="Polymarket odds revealed" />

              <div className="space-y-3.5 rounded-md border p-4" style={{ borderColor: "var(--d-border)", background: "var(--d-surface-2)" }}>
                {market.outcomes.map((o, i) => {
                  const aiEst = independent.outcomes.find((p) => p.label === o.label)?.probability;
                  return (
                    <OutcomeMeter
                      key={o.label}
                      label={o.label}
                      pct={o.price}
                      color={colorFor(i)}
                      markerPct={aiEst}
                      markerLabel="AI estimate"
                    />
                  );
                })}
                <p className="pt-0.5 text-[11px] text-text-faint">
                  Bars show the market. The line marks the AI&apos;s own estimate.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {comparison.edges.map((e) => (
                  <DiscoverEdgeChip key={e.label} label={e.label} edge={e.edge} />
                ))}
              </div>

              {comparison.bestValue ? (
                <div
                  className="flex items-start gap-2.5 rounded-md p-3.5 ring-1 ring-inset"
                  style={{ background: "rgba(var(--d-accent-rgb),0.08)", borderColor: "var(--d-accent)" }}
                >
                  <TrendingUpIcon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--d-accent)" }} />
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: "var(--d-accent)" }}>
                      Possible value
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-dim">
                      The AI rates <strong className="font-medium text-text">{comparison.bestValue}</strong> higher than the
                      market does.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2.5 rounded-md border p-3.5" style={{ borderColor: "var(--d-border)" }}>
                  <ScaleIcon className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" />
                  <div>
                    <p className="text-[13px] font-semibold text-text">Market looks efficient</p>
                    <p className="mt-0.5 text-xs text-text-dim">No meaningful edge on this one.</p>
                  </div>
                </div>
              )}

              <DiscoverConfidence level={comparison.confidence} />

              {comparison.verdict && (
                <p className="selectable text-[13px] leading-relaxed text-text-dim">{comparison.verdict}</p>
              )}

              <button
                onClick={handleSave}
                disabled={saved}
                className="press flex w-full items-center justify-center gap-2 rounded-md py-3.5 text-[13px] font-bold text-bg disabled:opacity-60"
                style={{ background: saved ? "var(--d-surface-2)" : "linear-gradient(135deg, var(--d-accent), var(--d-violet))" }}
              >
                <BookmarkIcon className="h-4 w-4" filled={saved} />
                {saved ? "Saved" : "Save this pick"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
        <div
          className="breathe flex h-9 w-9 shrink-0 items-center justify-center rounded-sm"
          style={{ background: "rgba(var(--d-accent-rgb),0.14)", color: "var(--d-accent)" }}
        >
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

      <div className="rounded-md border p-4" style={{ borderColor: "var(--d-border)", background: "var(--d-surface-2)" }}>
        <StepList steps={steps} activeIdx={activeIdx} />
      </div>

      <p className="mt-3 px-1 text-[11px] leading-relaxed text-text-faint">
        Deep research can take up to a minute. You&apos;ll see the AI&apos;s own estimate first, then how it compares to
        the market.
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
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
              style={{
                background: done || active ? "rgba(var(--d-accent-rgb),0.15)" : "var(--d-surface)",
                color: done ? "var(--d-accent)" : undefined,
              }}
            >
              {done ? (
                <svg viewBox="0 0 24 24" fill="none" className="h-2.5 w-2.5">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : active ? (
                <span className="pulse-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--d-accent)" }} />
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
    <div className="rounded-md border p-3.5" style={{ borderColor: "var(--d-border)" }}>
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
              className="block truncate text-xs text-text-dim underline-offset-2 hover:underline"
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-text-dim" style={{ background: "var(--d-surface-2)" }}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-text-faint"
            style={{ background: "var(--d-surface-2)" }}
          >
            {step}/2
          </span>
          <p className="truncate text-[13px] font-semibold text-text">{title}</p>
        </div>
        <p className="text-[11px] text-text-faint">{subtitle}</p>
      </div>
    </div>
  );
}

function DiscoverConfidence({ level }: { level: Confidence }) {
  const label = level === "high" ? "High confidence" : level === "medium" ? "Medium confidence" : "Low confidence";
  const color = level === "high" ? "var(--d-accent)" : level === "medium" ? "var(--d-accent-2)" : "var(--text-faint)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset"
      style={{ color, borderColor: color, background: "transparent" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function DiscoverEdgeChip({ label, edge }: { label: string; edge: number }) {
  const positive = edge > 0.005;
  const negative = edge < -0.005;
  const color = positive ? "var(--d-accent)" : negative ? "var(--d-accent-2)" : "var(--text-faint)";
  return (
    <div
      className="flex flex-col items-center gap-0.5 rounded-sm px-2 py-2.5 ring-1 ring-inset"
      style={{ color, borderColor: `${color}33`, background: `${color}14` }}
    >
      <span className="max-w-full truncate text-[10px] opacity-80">{label}</span>
      <span className="font-display text-[13px] font-semibold tabular-nums">{toSignedPercent(edge)}</span>
    </div>
  );
}

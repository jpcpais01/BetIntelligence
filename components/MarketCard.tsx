"use client";

import { useState } from "react";
import type { Market, Confidence } from "@/lib/types";
import type { LastMarketAnalysisEntry } from "@/lib/lastMarketAnalysis";
import { formatCompactNumber, formatEndDate, formatRelativeTime, toPercent, toSignedPercent, formatCostUsd } from "@/lib/format";
import { agreementLabel, agreementTone } from "@/lib/aggregate";
import { ChevronDownIcon, ExternalLinkIcon, FlameIcon, SparkleIcon, BrainIcon, TrendingUpIcon } from "./icons";
import OutcomeMeter from "./OutcomeMeter";
import ResearchRunsStepper from "./ResearchRunsStepper";
import OddsHistoryChart from "./OddsHistoryChart";

// Capped so the chart stays legible — a dozen-outcome market would otherwise draw a dozen
// overlapping lines.
const MAX_HISTORY_OUTCOMES = 4;

const OUTCOME_COLORS = ["var(--d-accent)", "var(--d-violet)", "var(--d-accent-2)", "#8f9dff", "#ff8a5c", "#5cc9ff"];

export default function MarketCard({
  market,
  hot,
  onAnalyze,
  style,
  lastAnalysis,
}: {
  market: Market;
  hot?: boolean;
  onAnalyze: (market: Market) => void;
  style?: React.CSSProperties;
  lastAnalysis?: LastMarketAnalysisEntry | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const top = market.outcomes[0];
  const isBinary = market.totalOutcomes === 2;
  const extraCount = market.totalOutcomes - market.outcomes.length;

  return (
    <div
      className={`hud-corners pop-in relative rounded-md border p-4 ${hot ? "glow-pulse" : ""}`}
      style={{
        background: "var(--d-surface)",
        borderColor: "var(--d-border)",
        ...(hot ? { "--hud-color": "var(--d-accent-2)" } : {}),
        ...style,
      } as React.CSSProperties}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-text-faint">
          <span>{market.categoryEmoji}</span>
          {market.category}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {hot && (
            <span
              className="pulse-dot inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ background: "rgba(var(--d-accent-2-rgb), 0.16)", color: "var(--d-accent-2)" }}
            >
              <FlameIcon className="h-3 w-3" />
              Hot
            </span>
          )}
          <a
            href={market.polymarketUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label="Open on Polymarket"
            className="press rounded-sm p-1.5 text-text-faint ring-1 ring-inset hover:text-text"
            style={{ borderColor: "var(--d-border)" }}
          >
            <ExternalLinkIcon className="h-3 w-3" />
          </a>
        </div>
      </div>

      <h3 className="mb-3.5 text-[14px] font-semibold leading-snug text-text">{market.title}</h3>

      <div className="mb-3.5">
        <p className="glow-text font-display text-[34px] font-bold leading-none tabular-nums" style={{ color: "var(--d-accent)" }}>
          {Math.round(top.price * 100)}
          <span className="text-lg">%</span>
        </p>
        <p className="mt-1 truncate text-[11px] uppercase tracking-wide text-text-faint">{top.label}</p>
      </div>

      {isBinary ? (
        <div className="mb-3.5 h-2 w-full overflow-hidden rounded-sm bg-black/40">
          <div
            className="grow-bar h-full"
            style={{ width: `${top.price * 100}%`, background: "var(--d-accent)", boxShadow: "0 0 6px var(--d-accent)" }}
          />
        </div>
      ) : (
        <div className="mb-3.5">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="press mb-2 flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-text-dim ring-1 ring-inset"
            style={{ background: "var(--d-surface-2)", borderColor: "var(--d-border)" }}
          >
            <span>
              {expanded ? "Hide" : "Show"} all {market.totalOutcomes} options
            </span>
            <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
          {expanded ? (
            <div className="space-y-2.5 rounded-sm p-2.5" style={{ background: "var(--d-surface-2)" }}>
              {market.outcomes.map((o, i) => (
                <OutcomeMeter key={o.label} label={o.label} pct={o.price} color={OUTCOME_COLORS[i % OUTCOME_COLORS.length]} size="sm" />
              ))}
              {extraCount > 0 && (
                <p className="text-[10px] text-text-faint">+{extraCount} more not shown</p>
              )}
            </div>
          ) : (
            <div className="h-2 w-full overflow-hidden rounded-sm bg-black/40">
              <div
                className="grow-bar h-full"
                style={{ width: `${top.price * 100}%`, background: "var(--d-accent)", boxShadow: "0 0 6px var(--d-accent)" }}
              />
            </div>
          )}
        </div>
      )}

      <PriceHistoryPanel market={market} />

      {lastAnalysis && <LastAnalysisPanel entry={lastAnalysis} />}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-[10px] uppercase tracking-wide text-text-faint">
          <span className="tabular-nums">${formatCompactNumber(market.volume)} vol</span>
          <span className="mx-1.5">&middot;</span>
          <span>{formatEndDate(market.endDate)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ResearchRunsStepper variant="discover" />
          <button
            onClick={() => onAnalyze(market)}
            className="press inline-flex items-center gap-1.5 rounded-sm px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide"
            style={{ background: "var(--d-accent)", color: "var(--bg)" }}
          >
            <SparkleIcon className="h-3.5 w-3.5" />
            Analyze
          </button>
        </div>
      </div>
    </div>
  );
}

// A small collapsed-by-default dropdown showing how this market's top outcomes have moved over
// the past week — only offered when Polymarket gave us a CLOB token id for at least one of them.
function PriceHistoryPanel({ market }: { market: Market }) {
  const [expanded, setExpanded] = useState(false);
  const chartOutcomes = market.outcomes.slice(0, MAX_HISTORY_OUTCOMES);
  if (!chartOutcomes.some((o) => o.tokenId)) return null;

  return (
    <div className="mb-3.5 overflow-hidden rounded-sm" style={{ background: "var(--d-surface-2)" }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="press flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-[11px] text-text-dim">
          <TrendingUpIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--d-accent)" }} />
          Odds history
        </span>
        <ChevronDownIcon className={`h-3 w-3 shrink-0 text-text-faint transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="rise-in px-2.5 pb-2.5">
          <OddsHistoryChart
            surfaceColor="var(--d-surface-2)"
            outcomes={chartOutcomes.map((o, i) => ({
              label: o.label,
              tokenId: o.tokenId,
              current: o.price,
              color: OUTCOME_COLORS[i % OUTCOME_COLORS.length],
            }))}
          />
        </div>
      )}
    </div>
  );
}

// Shown whenever this market has been analyzed before, whether or not that analysis was ever
// saved to Picks — a collapsed one-line summary that expands into the full read.
function LastAnalysisPanel({ entry }: { entry: LastMarketAnalysisEntry }) {
  const [expanded, setExpanded] = useState(false);
  const { independent, comparison } = entry;
  const topOutcome = independent.outcomes.reduce((best, o) => (o.probability > best.probability ? o : best), independent.outcomes[0]);
  const bestEdge = comparison.bestValue ? comparison.edges.find((e) => e.label === comparison.bestValue) : null;

  return (
    <div className="mb-3.5 overflow-hidden rounded-sm" style={{ background: "var(--d-surface-2)" }}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        className="press flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <BrainIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--d-accent)" }} />
          <span className="truncate text-[11px] text-text-dim">
            AI: <strong className="font-medium text-text">{topOutcome.label}</strong>{" "}
            <span className="tabular-nums">{toPercent(topOutcome.probability)}</span>
            {bestEdge && (
              <span className="ml-1 tabular-nums" style={{ color: "var(--d-accent)" }}>
                {toSignedPercent(bestEdge.edge)} edge
              </span>
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums text-text-faint">
          {formatCostUsd(entry.totalCostUsd) && <span>{formatCostUsd(entry.totalCostUsd)}</span>}
          <span>{formatRelativeTime(entry.analyzedAt)}</span>
          <ChevronDownIcon className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {expanded && (
        <div className="rise-in space-y-3 px-2.5 pb-2.5">
          <div className="space-y-2.5 rounded-sm p-2.5" style={{ background: "var(--d-surface)" }}>
            {entry.market.map((o, i) => {
              const aiEst = independent.outcomes.find((p) => p.label === o.label)?.probability;
              return (
                <OutcomeMeter
                  key={o.label}
                  label={o.label}
                  pct={o.price}
                  color={OUTCOME_COLORS[i % OUTCOME_COLORS.length]}
                  markerPct={aiEst}
                  markerLabel="AI estimate"
                  size="sm"
                />
              );
            })}
            <p className="text-[10px] text-text-faint">Bars show the market at analysis time. The line marks the AI&apos;s estimate.</p>
          </div>

          {entry.research && entry.research.runCount > 1 && (
            <p
              className="text-[11px] font-medium"
              style={{
                color:
                  agreementTone(entry.research) === "high"
                    ? "var(--d-accent)"
                    : agreementTone(entry.research) === "medium"
                      ? "var(--d-accent-2)"
                      : "#ff6b6b",
              }}
            >
              {agreementLabel(entry.research)}
            </p>
          )}

          <DiscoverConfidence level={comparison.confidence} />

          {comparison.verdict && <p className="selectable text-[12px] leading-relaxed text-text-dim">{comparison.verdict}</p>}
        </div>
      )}
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

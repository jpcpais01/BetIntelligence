"use client";

import { useState } from "react";
import type { Market } from "@/lib/types";
import { formatCompactNumber, formatEndDate } from "@/lib/format";
import { ChevronDownIcon, ExternalLinkIcon, FlameIcon, SparkleIcon } from "./icons";
import OutcomeMeter from "./OutcomeMeter";
import ResearchRunsStepper from "./ResearchRunsStepper";

const OUTCOME_COLORS = ["var(--d-accent)", "var(--d-violet)", "var(--d-accent-2)", "#8f9dff", "#ff8a5c", "#5cc9ff"];

export default function MarketCard({
  market,
  hot,
  onAnalyze,
  style,
}: {
  market: Market;
  hot?: boolean;
  onAnalyze: (market: Market) => void;
  style?: React.CSSProperties;
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

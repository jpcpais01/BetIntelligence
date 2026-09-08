"use client";

import { useState } from "react";
import type { Game, Probabilities } from "@/lib/types";
import type { LastAnalysisEntry } from "@/lib/lastAnalysis";
import type { LiveScoreEntry } from "@/lib/liveScores";
import { formatCompactNumber, formatKickoff, formatRelativeTime, toPercent, toSignedPercent, formatCostUsd } from "@/lib/format";
import { isTopGame } from "@/lib/topTeams";
import { agreementLabel, agreementTone } from "@/lib/aggregate";
import { riskLevelFor, riskLevelLabel, riskLevelColor, type RiskLevel } from "@/lib/riskLevel";
import Avatar from "./Avatar";
import OutcomeBar from "./OutcomeBar";
import ConfidenceBadge from "./ConfidenceBadge";
import ResearchRunsStepper from "./ResearchRunsStepper";
import OddsHistoryChart from "./OddsHistoryChart";
import { SparkleIcon, StarIcon, CheckIcon, BrainIcon, ChevronDownIcon, TrendingUpIcon } from "./icons";

// One flowing signal line per risk tier (see .risk-bg-* in app/globals.css), drawn once here as a
// single period of a 200×60 SVG path — CSS tiles and scrolls it seamlessly, never regenerated at
// runtime. The SHAPE itself carries the tier's identity, not just its speed or color: a smooth
// gentle roll for Calm, tightening and quickening through Easy/Normal/Risky, arriving at Mega as a
// genuinely different shape — a flat signal with sharp spikes, reading as urgent rather than just
// "the same wave, faster". Every path starts and ends at the same baseline (y=30) moving the same
// direction, which is what makes the seam invisible when the two tiled copies meet.
const WAVE_PATH: Record<RiskLevel, string> = {
  calm: "M0,30 Q50,22 100,30 Q150,38 200,30",
  easy: "M0,30 Q25,20 50,30 Q75,40 100,30 Q125,20 150,30 Q175,40 200,30",
  normal: "M0,30 Q25,24 50,30 Q75,36 100,30 Q125,24 150,30 Q175,36 200,30",
  risky: "M0,30 Q16.7,18 33.3,30 Q50,42 66.7,30 Q83.3,18 100,30 Q116.7,42 133.3,30 Q150,18 166.7,30 Q183.3,42 200,30",
  mega: "M0,30 L20,30 L26,16 L32,44 L38,30 L100,30 L120,30 L126,16 L132,44 L138,30 L200,30",
};

// One period, tiled twice side by side and scrolled exactly one tile-width (see risk-wave-scroll,
// app/globals.css) — a seamless infinite loop using only `transform`, the standard CSS marquee
// technique: translate a doubled-up strip by exactly half its own width and the seam is invisible.
function WaveRow({ level, className }: { level: RiskLevel; className: string }) {
  const d = WAVE_PATH[level];
  return (
    <div className={className}>
      <div className="risk-wave-track">
        {[0, 1].map((i) => (
          <svg key={i} viewBox="0 0 200 60" preserveAspectRatio="none">
            <path d={d} fill="none" vectorEffect="non-scaling-stroke" />
          </svg>
        ))}
      </div>
    </div>
  );
}

export default function GameCard({
  game,
  onAnalyze,
  style,
  selectMode = false,
  selected = false,
  onToggleSelect,
  lastAnalysis,
  liveScore,
  liveOdds,
  lineupsReady,
}: {
  game: Game;
  onAnalyze: (game: Game) => void;
  style?: React.CSSProperties;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (game: Game) => void;
  lastAnalysis?: LastAnalysisEntry | null;
  liveScore?: LiveScoreEntry | null;
  // The market's real current price, straight from CLOB (see app/sports/page.tsx) — the exact
  // source and window the odds-history panel below draws its own chart from, so the two can never
  // disagree. Refreshed for every listed game whenever the list itself changes, and every few
  // seconds for whichever games have actually kicked off. Falls back to `game.odds` (the plain
  // snapshot from the last general refresh) only for a token CLOB has no recent trade for.
  liveOdds?: Probabilities | null;
  // Whether ESPN has posted a starting XI for this match yet — polled every few minutes once
  // within an hour of kickoff (see app/sports/page.tsx). Purely a heads-up that the NEXT analysis
  // will have squad data to work with; it doesn't fetch or show the lineup itself here.
  lineupsReady?: boolean;
}) {
  const { label: kickoffLabel, isLive: heuristicLive } = formatKickoff(game.startTime);
  const top = isTopGame(game);
  const effectiveOdds = liveOdds ?? game.odds;

  // A real score (when available) replaces the plain "LIVE NOW" guess with the actual result AND
  // the actual match clock — "63' 2-1", "HT 1-0", "FT 3-1" — falling back to the existing
  // kickoff-based label for leagues/matches this enrichment doesn't cover. The clock is what makes
  // this read as genuinely live rather than just eventually-correct: a bare "LIVE" label never told
  // you whether that meant kickoff just happened or the 90th minute.
  // liveScore is already filtered to live-relevant statuses (getLiveScores excludes anything not
  // yet kicked off or not resolved), but the check here still spells out exactly which statuses
  // count as "live" rather than assuming "not FINISHED" — so a not-yet-started or postponed match
  // can never render as "LIVE 0-0" even if that filtering upstream ever changed.
  const scoreLabel = liveScore
    ? `${liveScore.clockLabel ?? (liveScore.status === "FINISHED" ? "FT" : "LIVE")} ${liveScore.homeGoals ?? "-"}-${liveScore.awayGoals ?? "-"}`
    : null;
  const isLive = liveScore ? liveScore.status === "IN_PLAY" || liveScore.status === "PAUSED" : heuristicLive;

  // A one-word read on how bold the AI's actual recommendation is, from its own AI-vs-market edge
  // on that specific outcome — not shown at all when there's no recommendation to rate (bestValue
  // "none", or never analyzed). Uses the edge AT ANALYSIS TIME (entry.comparison.edges), not
  // something recomputed against the live-updating effectiveOdds above: this describes the call
  // that was actually made, which shouldn't relabel itself as prices move afterward.
  const bestValue = lastAnalysis?.comparison.bestValue;
  const riskLevel = lastAnalysis && bestValue && bestValue !== "none" ? riskLevelFor(lastAnalysis.comparison.edges[bestValue]) : null;

  // A Champions League fixture gets the competition's own blue wash instead of the neutral surface
  // every other card uses (.ucl-card, app/globals.css) — background only, so nothing on the card
  // reads any differently, it's just instantly recognisable as a European night while scrolling.
  // A rated card takes priority over that when both apply: the risk tier's own animated background
  // (below) already carries a strong color and mood of its own, tied to a specific recommendation
  // rather than the competition it's in, so layering the UCL wash underneath it would just muddy
  // both. `border-border-soft` here is deliberately plain — the animated layer supplies the color.
  const surfaceClassName = riskLevel
    ? "risk-bg-card border-border-soft"
    : game.league === "champions-league"
      ? "ucl-card"
      : "surface-lift border-border-soft";

  return (
    <div
      onClick={selectMode ? () => onToggleSelect?.(game) : undefined}
      className={`rise-in rounded-3xl border p-4 ${
        selectMode
          ? `cursor-pointer press ${selected ? "border-accent/40 bg-accent/6" : surfaceClassName}`
          : surfaceClassName
      }`}
      style={style}
    >
      {/* A static tinted wash (zero animation cost, see .risk-bg::before) plus two flowing signal
          lines — a brighter one and a fainter echo drifting the opposite way for depth. Only two
          animated elements per card, same as before, still transform-only. */}
      {riskLevel && !selectMode && (
        <div className={`risk-bg risk-bg-${riskLevel}`} aria-hidden="true">
          <WaveRow level={riskLevel} className="risk-wave-row risk-wave-row-main" />
          <WaveRow level={riskLevel} className="risk-wave-row risk-wave-row-echo" />
        </div>
      )}
      {selectMode && (
        <div
          className={`mb-3 flex h-5 w-5 items-center justify-center rounded-full ring-1 ring-inset ${
            selected ? "bg-accent text-bg ring-accent" : "bg-transparent text-transparent ring-border"
          }`}
        >
          <CheckIcon className="h-3 w-3" />
        </div>
      )}
      <div className="mb-3.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-faint">
          <span className="text-xs leading-none">{game.leagueFlag}</span>
          <span className="truncate">{game.leagueName}</span>
          {top && <StarIcon className="h-3 w-3 shrink-0 text-warn" filled />}
          {riskLevel && (
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{ color: riskLevelColor(riskLevel), background: `color-mix(in srgb, ${riskLevelColor(riskLevel)} 14%, transparent)` }}
            >
              {riskLevelLabel(riskLevel)}
            </span>
          )}
          {lineupsReady && (
            <span className="shrink-0 rounded-full bg-accent/14 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
              11s Are Here!
            </span>
          )}
        </div>
        <span
          className={`shrink-0 text-[11px] tabular-nums ${isLive ? "font-medium text-accent-3" : "text-text-faint"}`}
        >
          {isLive && <span className="pulse-dot mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent-3 align-middle" />}
          {scoreLabel ?? kickoffLabel}
        </span>
      </div>

      <div className="mb-4 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <Avatar name={game.homeTeam} size={26} />
          <div className="min-w-0 flex-1">
            <OutcomeBar label={game.homeTeam} pct={effectiveOdds.home} color="home" size="sm" />
          </div>
        </div>

        <div className="flex items-center gap-2 pl-[36px]">
          <span className="shrink-0 text-[11px] text-text-faint">Draw</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="grow-bar h-full rounded-full"
              style={{ width: `${effectiveOdds.draw * 100}%`, background: "var(--draw)", opacity: 0.9 }}
            />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-text-faint">
            {Math.round(effectiveOdds.draw * 100)}%
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <Avatar name={game.awayTeam} size={26} />
          <div className="min-w-0 flex-1">
            <OutcomeBar label={game.awayTeam} pct={effectiveOdds.away} color="away" size="sm" />
          </div>
        </div>
      </div>

      {!selectMode && <PriceHistoryPanel game={game} odds={effectiveOdds} />}

      {/* Shown regardless of whether the match has kicked off — a pre-match read is still worth
          seeing once the game is live (it's what you had going in), and re-tapping Analyze any
          time replaces it with a fresh one anyway. */}
      {!selectMode && lastAnalysis && <LastAnalysisPanel game={game} entry={lastAnalysis} />}

      <div className="flex items-center justify-between gap-3 border-t border-border-soft pt-3">
        <span className="text-[11px] tabular-nums text-text-faint">
          ${formatCompactNumber(game.volume)} vol
        </span>
        {!selectMode && (
          <div className="flex items-center gap-1.5">
            <ResearchRunsStepper />
            <button
              // Analysis compares the AI's independent read against "the market" using whatever
              // odds this game carries at that moment — so it has to be effectiveOdds (CLOB's
              // current price), the exact number already on screen, not game.odds's possibly
              // stale Gamma snapshot. Otherwise a live match's odds could visibly show one price
              // while the analysis a moment later compared against a different, older one.
              onClick={() => onAnalyze({ ...game, odds: effectiveOdds })}
              className="press inline-flex items-center gap-1.5 rounded-full bg-accent/12 px-3.5 py-2 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/25 hover:bg-accent/18"
            >
              <SparkleIcon className="h-3.5 w-3.5" />
              Analyze
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// A small collapsed-by-default dropdown showing how this match's 1X2 odds have moved over the
// past week (or, once kicked off, since kickoff at 1-minute precision — see OddsHistoryChart's
// "LIVE" window) — only offered when Polymarket actually gave us a CLOB token id for at least one
// side, since there's nothing to chart otherwise.
function PriceHistoryPanel({ game, odds }: { game: Game; odds: Probabilities }) {
  const [expanded, setExpanded] = useState(false);
  const { tokenIds } = game;
  if (!tokenIds || (!tokenIds.home && !tokenIds.draw && !tokenIds.away)) return null;

  return (
    <div className="mb-4 overflow-hidden rounded-xl bg-surface-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="press flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-[11px] text-text-dim">
          <TrendingUpIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          Odds history
        </span>
        <ChevronDownIcon className={`h-3 w-3 shrink-0 text-text-faint transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="rise-in px-3 pb-3">
          <OddsHistoryChart
            surfaceColor="var(--surface-2)"
            kickoffTime={game.startTime}
            outcomes={[
              { label: firstWord(game.homeTeam), tokenId: tokenIds.home, current: odds.home, color: "var(--home)" },
              { label: "Draw", tokenId: tokenIds.draw, current: odds.draw, color: "var(--draw)" },
              { label: firstWord(game.awayTeam), tokenId: tokenIds.away, current: odds.away, color: "var(--away)" },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function firstWord(name: string): string {
  return name.split(" ")[0];
}

function topOutcome(p: { home: number; draw: number; away: number }): "home" | "draw" | "away" {
  if (p.home >= p.draw && p.home >= p.away) return "home";
  if (p.away >= p.draw) return "away";
  return "draw";
}

// Shown on the card whenever this match has been analyzed before, whether or not that analysis
// was ever saved to Picks — a collapsed one-line summary that expands into the full read.
function LastAnalysisPanel({ game, entry }: { game: Game; entry: LastAnalysisEntry }) {
  const [expanded, setExpanded] = useState(false);
  const { independent, comparison } = entry;
  const top = topOutcome(independent);
  const topLabel = top === "home" ? game.homeTeam : top === "away" ? game.awayTeam : "Draw";
  const bestValue = comparison.bestValue;
  const edge = bestValue !== "none" ? comparison.edges[bestValue] : 0;

  return (
    <div className="mb-4 overflow-hidden rounded-xl bg-surface-2">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        className="press flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <BrainIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="truncate text-[11px] text-text-dim">
            AI: <strong className="font-medium text-text">{topLabel}</strong>{" "}
            <span className="tabular-nums">{toPercent(independent[top])}</span>
            {bestValue !== "none" && (
              <span className="ml-1 tabular-nums text-accent">{toSignedPercent(edge)} edge</span>
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
        <div className="rise-in space-y-3 px-3 pb-3">
          <div className="space-y-2.5 rounded-lg bg-bg-elevated p-3">
            <OutcomeBar
              label={game.homeTeam}
              pct={entry.market.home}
              color="home"
              markerPct={independent.home}
              markerLabel="AI estimate"
            />
            <OutcomeBar label="Draw" pct={entry.market.draw} color="draw" markerPct={independent.draw} markerLabel="AI estimate" />
            <OutcomeBar
              label={game.awayTeam}
              pct={entry.market.away}
              color="away"
              markerPct={independent.away}
              markerLabel="AI estimate"
            />
            <p className="text-[10px] text-text-faint">Bars show the market at analysis time. The line marks the AI&apos;s estimate.</p>
          </div>

          {entry.research && entry.research.runCount > 1 && (
            <p
              className={`text-[11px] font-medium ${
                agreementTone(entry.research) === "high"
                  ? "text-accent"
                  : agreementTone(entry.research) === "medium"
                    ? "text-warn"
                    : "text-accent-3"
              }`}
            >
              {agreementLabel(entry.research)}
            </p>
          )}

          <ConfidenceBadge level={comparison.confidence} />

          {comparison.verdict && <p className="selectable text-[12px] leading-relaxed text-text-dim">{comparison.verdict}</p>}
        </div>
      )}
    </div>
  );
}

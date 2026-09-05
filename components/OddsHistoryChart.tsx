"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchOddsHistory, type HistoryPoint, type HistorySeries } from "@/lib/oddsHistory";
import { toPercent } from "@/lib/format";

export interface HistoryOutcomeInput {
  label: string;
  tokenId: string | null | undefined;
  current: number;
  color: string;
}

const CHART_W = 300;
const CHART_H = 108;
const PAD_L = 30;
const PAD_R = 6;
const PAD_T = 10;
const PAD_B = 6;
const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;

function niceTick(p: number): string {
  return `${Math.round(p * 100)}%`;
}

// Each window fetches its OWN interval/fidelity from CLOB (lib/oddsHistoryServer.ts's
// WINDOW_CONFIG) rather than just re-slicing the 7-day series, so 1D shows real half-hour
// resolution and 3H real five-minute resolution — each one strictly finer than the last, not the
// same coarse 3-hour buckets zoomed in. `ms` here is the window this button actually promises;
// CLOB has no exact "3h" interval, so that one over-fetches 6h and gets trimmed down to this.
const WINDOWS = [
  { id: "7d", label: "7D", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "1d", label: "1D", ms: 24 * 60 * 60 * 1000 },
  { id: "3h", label: "3H", ms: 3 * 60 * 60 * 1000 },
] as const;
type WindowId = (typeof WINDOWS)[number]["id"];

export default function OddsHistoryChart({
  outcomes,
  surfaceColor = "var(--surface-2)",
}: {
  outcomes: HistoryOutcomeInput[];
  // Matches whatever background this chart is dropped onto, so end-dot rings blend in rather
  // than showing a mismatched halo (Discover's dark-green theme vs. Sports' neutral one).
  surfaceColor?: string;
}) {
  // Keyed by depKey+window together (not two separate "which outcomes" / "which window" pieces
  // of state) so a change to either invalidates cleanly with no race between an outcomes-changed
  // reset and a window-changed fetch landing in the wrong order. Each distinct combination this
  // card instance visits is cached — switching back to an already-fetched window is instant, no
  // re-fetch, and the user's window choice survives a price tick changing depKey underneath it.
  const [cache, setCache] = useState<Record<string, HistorySeries[]>>({});
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set());
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [windowId, setWindowId] = useState<WindowId>("7d");
  const svgRef = useRef<SVGSVGElement>(null);

  const depKey = outcomes.map((o) => `${o.label}:${o.tokenId ?? ""}:${o.current}`).join("|");
  const cacheKey = `${depKey}::${windowId}`;

  useEffect(() => {
    if (cache[cacheKey] !== undefined || failedKeys.has(cacheKey)) return;
    let cancelled = false;
    fetchOddsHistory(
      outcomes.map((o) => ({ label: o.label, tokenId: o.tokenId ?? null, current: o.current, color: o.color })),
      windowId
    )
      .then((result) => {
        if (cancelled) return;
        setCache((cur) => ({ ...cur, [cacheKey]: result }));
      })
      .catch(() => {
        if (cancelled) return;
        setFailedKeys((cur) => new Set(cur).add(cacheKey));
      });
    return () => {
      cancelled = true;
    };
    // cacheKey is the real dependency (a flattened primitive of everything outcomes and windowId
    // carry) — cache/failedKeys are read here to decide whether to skip an already-satisfied
    // fetch, not depended on (including them would refetch every time this effect's own success
    // handler updates them).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const series = cache[cacheKey] ?? null;
  const failed = failedKeys.has(cacheKey);

  // Anchored to the latest point actually in the data, not wall-clock Date.now() — the fetch can
  // lag "now" by a little, and clipping against real time would cut off the most recent point.
  // Also trims a window whose real CLOB interval had to over-fetch (3H asks CLOB for its
  // shortest useful interval, 6h, then this cuts it down to the labeled 3h) to what the button
  // actually promises.
  const windowed = useMemo(() => {
    if (!series) return null;
    const windowMs = WINDOWS.find((w) => w.id === windowId)!.ms;
    const allTimes = series.flatMap((s) => s.points.map((p) => new Date(p.t).getTime()));
    if (allTimes.length === 0) return series;
    const cutoff = Math.max(...allTimes) - windowMs;
    return series.map((s) => ({ ...s, points: s.points.filter((p) => new Date(p.t).getTime() >= cutoff) }));
  }, [series, windowId]);

  const plottable = useMemo(() => (windowed ?? []).filter((s) => s.points.length >= 2), [windowed]);

  const scale = useMemo(() => {
    const all = plottable.flatMap((s) => s.points);
    if (all.length === 0) return null;
    const times = all.map((p) => new Date(p.t).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const prices = all.map((p) => p.p);
    let minP = Math.min(...prices);
    let maxP = Math.max(...prices);
    const pad = Math.max(0.015, (maxP - minP) * 0.15);
    minP = Math.max(0, minP - pad);
    maxP = Math.min(1, maxP + pad);
    if (maxP - minP < 0.04) {
      const mid = (maxP + minP) / 2;
      minP = Math.max(0, mid - 0.03);
      maxP = Math.min(1, mid + 0.03);
    }
    const x = (t: number) => PAD_L + (maxT === minT ? 0 : ((t - minT) / (maxT - minT)) * PLOT_W);
    const y = (p: number) => PAD_T + (1 - (p - minP) / (maxP - minP || 1)) * PLOT_H;
    return { minT, maxT, minP, maxP, x, y };
  }, [plottable]);

  const handlePointerMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!scale || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const frac = Math.min(1, Math.max(0, (relX - PAD_L) / PLOT_W));
    setHoverT(scale.minT + frac * (scale.maxT - scale.minT));
  };

  const clearHover = () => setHoverT(null);

  if (failed) {
    return <p className="px-1 py-3 text-center text-[11px] text-text-faint">Couldn&apos;t load price history right now.</p>;
  }

  if (series === null) {
    return <div className="h-[108px] w-full animate-pulse rounded-sm bg-[var(--surface,rgba(255,255,255,0.04))]" />;
  }

  if (!scale || plottable.length === 0) {
    return (
      <div>
        <p className="px-1 py-3 text-center text-[11px] text-text-faint">
          Not enough trading history yet at this window.
        </p>
        <WindowSelector windowId={windowId} onSelect={setWindowId} />
      </div>
    );
  }

  const hoverPoints =
    hoverT !== null
      ? plottable.map((s) => ({ series: s, point: nearestPoint(s.points, hoverT) }))
      : null;

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full touch-none"
        onPointerMove={handlePointerMove}
        onPointerLeave={clearHover}
        onPointerUp={clearHover}
      >
        {[scale.minP, (scale.minP + scale.maxP) / 2, scale.maxP].map((p, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={CHART_W - PAD_R}
              y1={scale.y(p)}
              y2={scale.y(p)}
              stroke="var(--border-soft, rgba(255,255,255,0.08))"
              strokeWidth={1}
            />
            <text x={0} y={scale.y(p) + 3} fontSize={8} fill="var(--text-faint, #6b7280)">
              {niceTick(p)}
            </text>
          </g>
        ))}

        {plottable.map((s) => (
          <path
            key={s.label}
            d={s.points.map((pt, i) => `${i === 0 ? "M" : "L"}${scale.x(new Date(pt.t).getTime())},${scale.y(pt.p)}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {plottable.map((s) => {
          const last = s.points[s.points.length - 1];
          const cx = scale.x(new Date(last.t).getTime());
          const cy = scale.y(last.p);
          return (
            <g key={`${s.label}-end`}>
              <circle cx={cx} cy={cy} r={6} fill={surfaceColor} />
              <circle cx={cx} cy={cy} r={4} fill={s.color} />
            </g>
          );
        })}

        {hoverPoints && (
          <g>
            <line
              x1={scale.x(hoverT!)}
              x2={scale.x(hoverT!)}
              y1={PAD_T}
              y2={CHART_H - PAD_B}
              stroke="var(--text-faint, #6b7280)"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            {hoverPoints.map(
              ({ series: s, point }) =>
                point && (
                  <g key={`${s.label}-hover`}>
                    <circle cx={scale.x(new Date(point.t).getTime())} cy={scale.y(point.p)} r={5} fill={surfaceColor} />
                    <circle cx={scale.x(new Date(point.t).getTime())} cy={scale.y(point.p)} r={3} fill={s.color} />
                  </g>
                )
            )}
          </g>
        )}
      </svg>

      {hoverPoints ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm px-1.5 py-1" style={{ background: surfaceColor }}>
          <span className="text-[9px] text-text-faint">{formatHoverTime(hoverT!)}</span>
          {hoverPoints.map(
            ({ series: s, point }) =>
              point && (
                <span key={s.label} className="inline-flex items-center gap-1 text-[10px]">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                  <span className="tabular-nums font-medium text-text">{toPercent(point.p)}</span>
                  <span className="text-text-faint">{s.label}</span>
                </span>
              )
          )}
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {outcomes.map((o) => (
            <span key={o.label} className="inline-flex items-center gap-1 text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: o.color }} />
              <span className="text-text-faint">{o.label}</span>
              <span className="tabular-nums font-medium text-text">{toPercent(o.current)}</span>
            </span>
          ))}
        </div>
      )}
      <WindowSelector windowId={windowId} onSelect={setWindowId} />
    </div>
  );
}

function WindowSelector({ windowId, onSelect }: { windowId: WindowId; onSelect: (id: WindowId) => void }) {
  return (
    <div className="mt-1 flex items-center justify-center gap-1">
      {WINDOWS.map((w) => (
        <button
          key={w.id}
          onClick={() => onSelect(w.id)}
          className={`rounded-full px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wide transition-colors ${
            windowId === w.id ? "bg-surface-2 text-text ring-1 ring-inset ring-border-soft" : "text-text-faint"
          }`}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

function nearestPoint(points: HistoryPoint[], targetT: number): HistoryPoint | null {
  if (points.length === 0) return null;
  let best = points[0];
  let bestDiff = Math.abs(new Date(best.t).getTime() - targetT);
  for (const pt of points) {
    const diff = Math.abs(new Date(pt.t).getTime() - targetT);
    if (diff < bestDiff) {
      best = pt;
      bestDiff = diff;
    }
  }
  return best;
}

function formatHoverTime(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

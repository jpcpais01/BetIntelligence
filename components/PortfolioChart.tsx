"use client";

import { useRef, useState } from "react";
import type { PortfolioPoint } from "@/lib/portfolioHistory";
import { formatEur } from "@/lib/format";

const CHART_W = 320;
const CHART_H = 140;
const PAD_L = 46;
const PAD_R = 6;
const PAD_T = 10;
const PAD_B = 8;
const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;

export default function PortfolioChart({ series }: { series: PortfolioPoint[] }) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (series.length < 2) {
    return (
      <div className="flex h-[140px] items-center justify-center rounded-2xl bg-surface-2">
        <p className="text-[11px] text-text-faint">Not enough history yet — place a bet to start tracking.</p>
      </div>
    );
  }

  const values = series.map((p) => p.value);
  const minT = series[0].t;
  const maxT = series[series.length - 1].t;
  let minV = Math.min(...values);
  let maxV = Math.max(...values);
  const pad = Math.max(1, (maxV - minV) * 0.15);
  minV -= pad;
  maxV += pad;
  if (maxV - minV < 2) {
    const mid = (maxV + minV) / 2;
    minV = mid - 1;
    maxV = mid + 1;
  }

  const x = (t: number) => PAD_L + (maxT === minT ? 0 : ((t - minT) / (maxT - minT)) * PLOT_W);
  const y = (v: number) => PAD_T + (1 - (v - minV) / (maxV - minV || 1)) * PLOT_H;

  const trendingUp = values[values.length - 1] >= values[0];
  const color = trendingUp ? "var(--accent)" : "var(--accent-3)";

  const linePath = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t)},${y(p.value)}`).join(" ");
  const areaPath = `${linePath} L${x(maxT)},${PAD_T + PLOT_H} L${x(minT)},${PAD_T + PLOT_H} Z`;

  const handlePointerMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const frac = Math.min(1, Math.max(0, (relX - PAD_L) / PLOT_W));
    setHoverT(minT + frac * (maxT - minT));
  };

  const hoverPoint = hoverT !== null ? nearestPoint(series, hoverT) : null;

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full touch-none"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverT(null)}
        onPointerUp={() => setHoverT(null)}
      >
        <defs>
          <linearGradient id="portfolio-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        {[minV, (minV + maxV) / 2, maxV].map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={CHART_W - PAD_R} y1={y(v)} y2={y(v)} stroke="var(--border-soft)" strokeWidth={1} />
            <text x={0} y={y(v) + 3} fontSize={8} fill="var(--text-faint)">
              {formatEur(v)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#portfolio-area)" stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {(() => {
          const last = series[series.length - 1];
          return (
            <g>
              <circle cx={x(last.t)} cy={y(last.value)} r={6} fill="var(--surface)" />
              <circle cx={x(last.t)} cy={y(last.value)} r={4} fill={color} />
            </g>
          );
        })()}

        {hoverPoint && (
          <g>
            <line x1={x(hoverPoint.t)} x2={x(hoverPoint.t)} y1={PAD_T} y2={PAD_T + PLOT_H} stroke="var(--text-faint)" strokeWidth={1} strokeDasharray="2 2" />
            <circle cx={x(hoverPoint.t)} cy={y(hoverPoint.value)} r={5} fill="var(--surface)" />
            <circle cx={x(hoverPoint.t)} cy={y(hoverPoint.value)} r={3} fill={color} />
          </g>
        )}
      </svg>

      {hoverPoint && (
        <div className="mt-1.5 flex items-center justify-between rounded-lg bg-surface-2 px-2.5 py-1.5">
          <span className="text-[10px] text-text-faint">{formatHoverTime(hoverPoint.t)}</span>
          <span className="font-display text-[12px] font-bold tabular-nums text-text">{formatEur(hoverPoint.value)}</span>
        </div>
      )}
      <p className="mt-1 text-center text-[9px] uppercase tracking-wide text-text-faint">Past 7 days</p>
    </div>
  );
}

function nearestPoint(series: PortfolioPoint[], targetT: number): PortfolioPoint | null {
  if (series.length === 0) return null;
  let best = series[0];
  let bestDiff = Math.abs(best.t - targetT);
  for (const p of series) {
    const diff = Math.abs(p.t - targetT);
    if (diff < bestDiff) {
      best = p;
      bestDiff = diff;
    }
  }
  return best;
}

function formatHoverTime(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

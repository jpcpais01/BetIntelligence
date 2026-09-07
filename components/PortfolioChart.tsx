"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PortfolioPoint } from "@/lib/portfolioHistory";
import { formatEur } from "@/lib/format";

const CHART_W = 320;
const CHART_H = 140;
// No y-axis labels to leave room for any more, so the plot runs the full width of the card.
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 10;
const PAD_B = 8;
const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;

// How finely the line is resampled before the wave is applied. The underlying series can be as
// few as two points, and displacing only those would give an angular zig-zag rather than a water
// surface — so the same shape is redrawn as this many evenly spaced points and the wave is applied
// across all of them.
const SAMPLES = 160;

// Three sine layers whose frequencies don't divide into each other, two travelling one way and one
// the other. Summed, they never line up the same way twice, which is what keeps this from reading
// as a repeating cartoon wave and starts it reading as actual water. Amplitudes are in viewBox
// units against a 122-unit-tall plot: about 3 units at the crest, ~2.5% of the plot height, which
// is enough to read clearly as a moving surface while staying far too small to change what the
// line says about the numbers underneath it.
const WAVE_LAYERS = [
  { amp: 1.6, k: 0.055, speed: 0.85 },
  { amp: 0.95, k: 0.032, speed: -0.6 },
  { amp: 0.55, k: 0.091, speed: 1.3 },
];

// The whole surface swells and calms over ~20s rather than churning at one fixed intensity —
// real water is never equally choppy for minutes on end.
function swell(t: number): number {
  return 0.72 + 0.28 * Math.sin(t * 0.31);
}

// Displacement at a point, tapered to exactly zero at both ends: the first and last points are
// real, known values (the last one carries the "now" dot), so they stay pinned while the stretch
// between them moves. It also just looks right — water held in a basin is stillest at the edges.
function waveAt(x: number, u: number, t: number): number {
  const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
  let sum = 0;
  for (const layer of WAVE_LAYERS) sum += layer.amp * Math.sin(x * layer.k + t * layer.speed);
  return sum * taper * swell(t);
}

export default function PortfolioChart({ series }: { series: PortfolioPoint[] }) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const echoRef = useRef<SVGPathElement>(null);

  const enoughData = series.length >= 2;

  const geometry = useMemo(() => {
    if (!enoughData) return null;

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

    // The line resampled at an even spacing, each sample carrying the value linearly interpolated
    // between whichever two real points it falls between — the same shape, just enough vertices to
    // carry a smooth wave.
    const samples: { x: number; y: number; u: number }[] = [];
    let cursor = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const u = i / (SAMPLES - 1);
      const t = minT + u * (maxT - minT);
      while (cursor < series.length - 2 && series[cursor + 1].t < t) cursor++;
      const a = series[cursor];
      const b = series[cursor + 1] ?? a;
      const span = b.t - a.t;
      const frac = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
      samples.push({ x: x(t), y: y(a.value + (b.value - a.value) * frac), u });
    }

    return { x, y, minT, maxT, trendingUp: values[values.length - 1] >= values[0], samples };
  }, [series, enoughData]);

  // The wave is driven by writing `d` straight onto the paths rather than through React state:
  // this repaints every frame, and putting a 60fps clock into state would re-render the whole
  // chart (and its hover readout) just as often for no benefit.
  useEffect(() => {
    if (!geometry) return;
    if (typeof window === "undefined") return;
    // Someone who has asked their OS for less motion gets the same chart, just still.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const start = performance.now();
    const floor = PAD_T + PLOT_H;

    const draw = (nowMs: number) => {
      const t = (nowMs - start) / 1000;
      let line = "";
      let echo = "";
      for (let i = 0; i < geometry.samples.length; i++) {
        const s = geometry.samples[i];
        const dy = waveAt(s.x, s.u, t);
        line += `${i === 0 ? "M" : "L"}${s.x.toFixed(2)},${(s.y + dy).toFixed(2)}`;
        // The echo trails a little behind in phase and sits slightly lower, so the two crests
        // cross rather than move as one — the read is depth, a second ripple under the surface.
        const echoDy = waveAt(s.x, s.u, t - 0.55) * 0.7;
        echo += `${i === 0 ? "M" : "L"}${s.x.toFixed(2)},${(s.y + echoDy + 2.2).toFixed(2)}`;
      }
      lineRef.current?.setAttribute("d", line);
      echoRef.current?.setAttribute("d", echo);
      areaRef.current?.setAttribute(
        "d",
        `${line}L${geometry.samples[geometry.samples.length - 1].x.toFixed(2)},${floor}L${geometry.samples[0].x.toFixed(2)},${floor}Z`
      );
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [geometry]);

  if (!geometry) {
    return (
      <div className="flex h-[140px] items-center justify-center rounded-2xl bg-surface-2">
        <p className="text-[11px] text-text-faint">Not enough history yet — place a bet to start tracking.</p>
      </div>
    );
  }

  const { x, y, minT, maxT, trendingUp, samples } = geometry;

  // Up is tropical water — turquoise green in the shallows shifting to blue across the chart.
  // Down stays the app's plain red: a portfolio underwater isn't the kind of water this is for.
  const strokeRef = trendingUp ? "url(#portfolio-water)" : "var(--accent-3)";
  const areaFill = trendingUp ? "url(#portfolio-area-water)" : "url(#portfolio-area-down)";
  const dotColor = trendingUp ? "var(--water-2)" : "var(--accent-3)";

  const staticLine = samples.map((s, i) => `${i === 0 ? "M" : "L"}${s.x.toFixed(2)},${s.y.toFixed(2)}`).join("");
  const staticArea = `${staticLine}L${samples[samples.length - 1].x.toFixed(2)},${PAD_T + PLOT_H}L${samples[0].x.toFixed(2)},${PAD_T + PLOT_H}Z`;

  const handlePointerMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const frac = Math.min(1, Math.max(0, (relX - PAD_L) / PLOT_W));
    setHoverT(minT + frac * (maxT - minT));
  };

  const hoverPoint = hoverT !== null ? nearestPoint(series, hoverT) : null;
  const last = series[series.length - 1];

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
          <linearGradient id="portfolio-water" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--water-1)" />
            <stop offset="100%" stopColor="var(--water-2)" />
          </linearGradient>
          <linearGradient id="portfolio-area-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--water-1)" stopOpacity={0.26} />
            <stop offset="60%" stopColor="var(--water-2)" stopOpacity={0.1} />
            <stop offset="100%" stopColor="var(--water-2)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="portfolio-area-down" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-3)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--accent-3)" stopOpacity={0} />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={PAD_L}
            x2={CHART_W - PAD_R}
            y1={PAD_T + f * PLOT_H}
            y2={PAD_T + f * PLOT_H}
            stroke="var(--border-soft)"
            strokeWidth={1}
          />
        ))}

        <path ref={areaRef} d={staticArea} fill={areaFill} stroke="none" />
        <path
          ref={echoRef}
          d={staticLine}
          fill="none"
          stroke={strokeRef}
          strokeWidth={1.5}
          strokeOpacity={0.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          ref={lineRef}
          d={staticLine}
          fill="none"
          stroke={strokeRef}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <circle cx={x(last.t)} cy={y(last.value)} r={6} fill="var(--surface)" />
        <circle cx={x(last.t)} cy={y(last.value)} r={4} fill={dotColor} />

        {hoverPoint && (
          <g>
            <line
              x1={x(hoverPoint.t)}
              x2={x(hoverPoint.t)}
              y1={PAD_T}
              y2={PAD_T + PLOT_H}
              stroke="var(--text-faint)"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle cx={x(hoverPoint.t)} cy={y(hoverPoint.value)} r={5} fill="var(--surface)" />
            <circle cx={x(hoverPoint.t)} cy={y(hoverPoint.value)} r={3} fill={dotColor} />
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

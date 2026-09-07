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

// How finely the line is resampled before the wave is applied. The underlying series can be as few
// as two points, and displacing only those would give an angular zig-zag rather than a surface — so
// the same shape is redrawn at this resolution and the wave applied across all of it. It needs to
// be reasonably high: the sharp crests below are only sharp if there are enough vertices to carry
// the curvature.
const SAMPLES = 220;

// Trochoidal (Gerstner) waves, which is what water actually does and what a plain stack of sines
// can't: every particle on the surface travels in a circle rather than straight up and down, so as
// well as rising it drifts HORIZONTALLY — bunching together at the crests and spreading apart in
// the troughs. That asymmetry (peaked crests, broad flat troughs) is the whole visual signature of
// a water surface. Symmetric sines just read as a wobbling line, which is what the first attempt
// at this looked like.
//
// `steep` is how pronounced that horizontal bunching is, and it's kept well under the point where
// a wave would fold over itself. Frequencies don't divide into each other and the layers travel in
// opposite directions, so the pattern never repeats the same way twice.
const WAVE_LAYERS = [
  { amp: 2.0, k: 0.057, speed: 0.55, steep: 1.6 },
  { amp: 1.3, k: 0.101, speed: -0.88, steep: 1.3 },
  { amp: 0.85, k: 0.165, speed: 1.36, steep: 1.0 },
  { amp: 0.5, k: 0.272, speed: -2.0, steep: 0.7 },
];

// Sunlight dappling through moving water onto the surface below it. This is what actually makes
// the fill read as a body of water rather than a tinted triangle under a line — a waving edge
// alone never gets there. Each one drifts at its own rate and breathes on its own cycle, all
// clipped to whatever shape the water currently is.
const CAUSTICS = [
  { rx: 46, ry: 7, yFrac: 0.32, drift: 9.5, phase: 0.0, bob: 2.6, opacity: 0.15 },
  { rx: 31, ry: 5, yFrac: 0.52, drift: -6.2, phase: 1.9, bob: 3.4, opacity: 0.12 },
  { rx: 58, ry: 9, yFrac: 0.68, drift: 5.1, phase: 3.4, bob: 2.0, opacity: 0.09 },
  { rx: 24, ry: 4.5, yFrac: 0.44, drift: -11.8, phase: 5.1, bob: 4.1, opacity: 0.1 },
];

// Open water is never equally choppy for minutes on end — two slow, out-of-step swells ride on top
// of each other so the surface builds and calms on its own rhythm instead of churning at one fixed
// intensity forever.
function swell(t: number): number {
  return 0.62 + 0.26 * Math.sin(t * 0.23) + 0.12 * Math.sin(t * 0.089 + 1.7);
}

// Both components of the displacement at a point, tapered to exactly zero at each end: the first
// and last points are real, known values (the last carries the "now" dot), so they stay pinned
// while the stretch between them moves. It reads right, too — water in a basin is stillest where
// it meets the edge. The taper is squared near the ends (smoothstep) so the surface eases into
// stillness rather than being visibly clipped.
function displace(x: number, u: number, t: number): { dx: number; dy: number } {
  const clamped = Math.min(1, Math.max(0, u));
  const edge = Math.sin(Math.PI * clamped);
  const taper = edge * edge * swell(t);

  let dx = 0;
  let dy = 0;
  for (const layer of WAVE_LAYERS) {
    const phase = x * layer.k + t * layer.speed;
    dy += layer.amp * Math.sin(phase);
    dx -= layer.amp * layer.steep * Math.cos(phase);
  }
  return { dx: dx * taper, dy: dy * taper };
}

export default function PortfolioChart({ series }: { series: PortfolioPoint[] }) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const clipRef = useRef<SVGPathElement>(null);
  const glintRef = useRef<SVGPathElement>(null);
  const glintGradRef = useRef<SVGLinearGradientElement>(null);
  const causticRefs = useRef<(SVGEllipseElement | null)[]>([]);

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

    // The line resampled at even spacing, each sample carrying the value linearly interpolated
    // between whichever two real points it falls between — the same shape, just enough vertices to
    // carry a wave with real curvature.
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
    const { samples } = geometry;
    // Reused every frame rather than reallocated — the caustics below need to know where the
    // surface actually ended up at each x, and this runs 60 times a second.
    const surfaceY = new Float64Array(samples.length);

    const draw = (nowMs: number) => {
      const t = (nowMs - start) / 1000;
      let surface = "";
      let firstX = 0;
      let lastX = 0;

      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const { dx, dy } = displace(s.x, s.u, t);
        const px = s.x + dx;
        const py = s.y + dy;
        if (i === 0) firstX = px;
        if (i === samples.length - 1) lastX = px;
        surfaceY[i] = py;
        surface += `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`;
      }

      const area = `${surface}L${lastX.toFixed(2)},${floor}L${firstX.toFixed(2)},${floor}Z`;
      lineRef.current?.setAttribute("d", surface);
      glintRef.current?.setAttribute("d", surface);
      areaRef.current?.setAttribute("d", area);
      // The caustics are clipped to the water itself, so the clip has to keep up with the surface
      // as it moves — otherwise light would spill out over the crests.
      clipRef.current?.setAttribute("d", area);

      for (let i = 0; i < CAUSTICS.length; i++) {
        const c = CAUSTICS[i];
        const el = causticRefs.current[i];
        if (!el) continue;
        // Wraps across a span wider than the plot so a patch is never seen popping into existence
        // at the edge; the clip hides whatever is outside the water anyway.
        const span = PLOT_W + c.rx * 4;
        const drifted = (((t * c.drift + c.phase * 97) % span) + span) % span;
        const cx = PAD_L - c.rx * 2 + drifted;

        // Depth is measured from the surface DIRECTLY ABOVE this patch, not from the top of the
        // chart: the water is only as deep as the line is high at that x, and a fixed height would
        // put every patch outside the clip (invisible) wherever the line runs low.
        const idx = Math.min(samples.length - 1, Math.max(0, Math.round(((cx - PAD_L) / PLOT_W) * (samples.length - 1))));
        const top = surfaceY[idx];
        const depth = floor - top;
        const bob = Math.sin(t * 0.6 + c.phase) * c.bob;

        el.setAttribute("cx", cx.toFixed(1));
        el.setAttribute("cy", (top + depth * c.yFrac + bob).toFixed(1));
        // Shallow water gets smaller, fainter dapples — a full-size patch squeezed into a sliver
        // of depth would read as a band, not light.
        const shallow = Math.min(1, depth / 46);
        el.setAttribute("ry", Math.max(1, c.ry * shallow).toFixed(2));
        el.setAttribute(
          "opacity",
          (c.opacity * shallow * (0.55 + 0.45 * Math.sin(t * 0.8 + c.phase * 2))).toFixed(3)
        );
      }

      // Sunlight catching the surface: a narrow bright band sliding along the line, easing at the
      // ends of its run rather than looping at a constant rate, so it reads as a glint rolling
      // across water instead of a marquee.
      const cycle = (t % 7) / 7;
      const eased = cycle * cycle * (3 - 2 * cycle);
      glintGradRef.current?.setAttribute(
        "gradientTransform",
        `translate(${(-PLOT_W + eased * (PLOT_W * 2.2)).toFixed(1)} 0)`
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
            <stop offset="55%" stopColor="var(--water-1)" />
            <stop offset="100%" stopColor="var(--water-2)" />
          </linearGradient>
          <linearGradient id="portfolio-area-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--water-1)" stopOpacity={0.28} />
            <stop offset="55%" stopColor="var(--water-2)" stopOpacity={0.11} />
            <stop offset="100%" stopColor="var(--water-2)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="portfolio-area-down" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-3)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--accent-3)" stopOpacity={0} />
          </linearGradient>
          {/* The travelling glint: a narrow near-white band with nothing either side of it, slid
              along the line by moving the gradient itself rather than redrawing anything. */}
          <linearGradient
            ref={glintGradRef}
            id="portfolio-glint"
            gradientUnits="userSpaceOnUse"
            x1={PAD_L}
            y1="0"
            x2={PAD_L + PLOT_W * 0.42}
            y2="0"
          >
            <stop offset="0%" stopColor="#eafffb" stopOpacity={0} />
            <stop offset="50%" stopColor="#eafffb" stopOpacity={0.85} />
            <stop offset="100%" stopColor="#eafffb" stopOpacity={0} />
          </linearGradient>
          {/* Soft-edged by construction rather than by a blur filter — a radial falloff costs
              nothing to composite, and this is redrawn every frame. */}
          <radialGradient id="portfolio-caustic">
            <stop offset="0%" stopColor="#dffff8" stopOpacity={1} />
            <stop offset="45%" stopColor="#9df3e6" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#9df3e6" stopOpacity={0} />
          </radialGradient>
          <clipPath id="portfolio-water-clip">
            <path ref={clipRef} d={staticArea} />
          </clipPath>
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

        {trendingUp && (
          <g clipPath="url(#portfolio-water-clip)">
            {CAUSTICS.map((c, i) => (
              <ellipse
                key={i}
                ref={(el) => {
                  causticRefs.current[i] = el;
                }}
                cx={PAD_L + PLOT_W * (0.2 + i * 0.2)}
                cy={PAD_T + c.yFrac * PLOT_H}
                rx={c.rx}
                ry={c.ry}
                fill="url(#portfolio-caustic)"
                opacity={c.opacity}
              />
            ))}
          </g>
        )}

        <path
          ref={lineRef}
          d={staticLine}
          fill="none"
          stroke={strokeRef}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {trendingUp && (
          <path
            ref={glintRef}
            d={staticLine}
            fill="none"
            stroke="url(#portfolio-glint)"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

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

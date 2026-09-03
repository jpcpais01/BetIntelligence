"use client";

import { useEffect, useRef, useState } from "react";
import { randomDelayMs, randomRewardEur, formatRewardEur } from "@/lib/luckyMoney";

const FLIGHT_DURATION_MS = 5200;
const REWARD_DISPLAY_MS = 1800;

interface Flight {
  id: number;
  fromLeft: boolean;
  topVh: number;
  tiltDeg: number;
}

// A little easter egg: every 10-30s, a winged coin flies across the screen. Tap it in time and
// it pays out a (fake) token reward; miss it and it just flies off and a new one gets scheduled.
// Mounted once in the root layout so it can appear over any page.
export default function FlyingMoney() {
  const [flight, setFlight] = useState<Flight | null>(null);
  const [reward, setReward] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleNext = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setFlight({
        id: Date.now(),
        fromLeft: Math.random() < 0.5,
        topVh: 10 + Math.random() * 65,
        tiltDeg: -10 + Math.random() * 20,
      });
    }, randomDelayMs());
  };

  useEffect(() => {
    scheduleNext();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleMissed = () => {
    setFlight(null);
    scheduleNext();
  };

  const handleCatch = () => {
    if (!flight) return;
    setFlight(null);
    setReward(randomRewardEur());
    window.setTimeout(() => setReward(null), REWARD_DISPLAY_MS);
    scheduleNext();
  };

  return (
    <>
      {flight && (
        <button
          key={flight.id}
          onClick={handleCatch}
          onAnimationEnd={handleMissed}
          aria-label="Catch the flying money"
          className="flying-money fixed left-0 z-[45] p-2"
          style={
            {
              top: `${flight.topVh}vh`,
              animationName: flight.fromLeft ? "fly-across-rtl" : "fly-across-ltr",
              animationDuration: `${FLIGHT_DURATION_MS}ms`,
              "--fm-tilt": `${flight.tiltDeg}deg`,
            } as React.CSSProperties
          }
        >
          <MoneyWingsIcon />
        </button>
      )}

      {reward !== null && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center">
          <div className="reward-pop rounded-2xl border border-accent/30 bg-surface px-6 py-5 text-center shadow-xl">
            <p className="text-2xl">🎉</p>
            <p className="mt-1 text-[13px] font-semibold text-text">You won!</p>
            <p className="mt-0.5 font-display text-xl font-bold tabular-nums text-accent">
              {formatRewardEur(reward)}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function MoneyWingsIcon() {
  return (
    <svg viewBox="0 0 64 40" className="h-9 w-14 overflow-visible drop-shadow-lg">
      <g className="fm-wing fm-wing-left" style={{ transformOrigin: "22px 20px" }}>
        <path d="M22 20C11 7 -5 9 2 22c6 9 17 7 20-2Z" fill="#f2f3f5" opacity={0.92} />
      </g>
      <g className="fm-wing fm-wing-right" style={{ transformOrigin: "42px 20px" }}>
        <path d="M42 20C53 7 69 9 62 22c-6 9-17 7-20-2Z" fill="#f2f3f5" opacity={0.92} />
      </g>
      <rect x="14" y="9" width="36" height="22" rx="6" fill="var(--accent)" stroke="#0b0c0e" strokeWidth="1.4" />
      <circle cx="32" cy="20" r="7" fill="none" stroke="#0b0c0e" strokeOpacity={0.35} strokeWidth="1.2" />
      <text x="32" y="24" textAnchor="middle" fontSize="10" fontWeight={700} fill="#0b0c0e">
        €
      </text>
    </svg>
  );
}

"use client";

import { useEffect, useState } from "react";

const AUTO_DISMISS_MS = 5000;
const PIECE_COUNT = 32;

export interface CelebrationTeam {
  name: string;
  emoji: string;
  color: string;
}

interface FallingPiece {
  left: number;
  delay: number;
  duration: number;
  size: number;
  drift: number;
  emoji: string;
}

// A full-screen celebration for a bet that just won — single-leg (one club) or a parlay (one row
// per leg, each with its own emoji/color) alike. Every color and emoji is a runtime variable (from
// lib/clubVibe.ts's real-time Gemini call), never hardcoded, so this reads as "those specific
// clubs" rather than a generic confetti burst every time. Wrapped in its own `.lab` scope so the
// --slip-* tokens it borrows for the "look like the bet slip" panel resolve correctly regardless
// of which page (Home, not normally inside .lab) triggered it.
export default function WinCelebration({
  teams,
  fallEmojis,
  bgColors,
  onClose,
}: {
  teams: CelebrationTeam[];
  fallEmojis: string[];
  bgColors: [string, string];
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  // Randomizing piece placement is a one-off visual flourish, not derived state — generating it
  // in an effect (rather than during render) keeps render itself pure, same pattern as
  // BetSlipBar.tsx's ConfettiBurst.
  const [pieces, setPieces] = useState<FallingPiece[] | null>(null);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-off randomized visual on mount, not state synced from anything */
    setPieces(
      Array.from({ length: PIECE_COUNT }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.4,
        duration: 2.8 + Math.random() * 2.2,
        size: 16 + Math.random() * 16,
        drift: (Math.random() - 0.5) * 70,
        emoji: fallEmojis[i % fallEmojis.length],
      }))
    );
    // fallEmojis is stable for this component's whole mount-to-dismiss lifetime (a fresh
    // WinCelebration mounts per bet), so this only ever needs to run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isParlay = teams.length > 1;

  return (
    <div className="lab fixed inset-0 z-[200] flex items-center justify-center px-6" onClick={onClose}>
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(160deg, ${bgColors[0]}4d, ${bgColors[1]}4d), rgba(8,6,16,0.72)` }}
      />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {pieces?.map((p, i) => (
          <span
            key={i}
            className="celebrate-emoji-fall absolute top-0 select-none"
            style={
              {
                left: `${p.left}%`,
                fontSize: p.size,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                "--celebrate-drift": `${p.drift}px`,
              } as React.CSSProperties
            }
          >
            {p.emoji}
          </span>
        ))}
      </div>

      <div
        className="lab-pop-in relative z-[1] max-w-xs rounded-3xl border px-8 py-7 text-center shadow-2xl"
        style={{ background: "var(--slip-surface)", borderColor: "var(--slip-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-4xl">{teams[0].emoji}</p>
        <p className="mt-3 font-display text-[20px] font-bold text-text">Congratulations!</p>

        {isParlay ? (
          <div className="mt-3 space-y-1.5 text-left">
            {teams.map((t, i) => (
              <p key={`${t.name}-${i}`} className="flex items-center gap-2 text-[13px] text-text-dim">
                <span className="text-base">{t.emoji}</span>
                <span className="font-semibold" style={{ color: t.color }}>
                  {t.name}
                </span>
              </p>
            ))}
            <p className="pt-1 text-[11px] text-text-faint">Every leg came through</p>
          </div>
        ) : (
          <p className="mt-1 text-[13px] text-text-dim">
            <span className="font-semibold" style={{ color: teams[0].color }}>
              {teams[0].name}
            </span>{" "}
            came through {fallEmojis[1] ?? teams[0].emoji}
          </p>
        )}

        <button
          onClick={onClose}
          className="press mt-5 rounded-full px-5 py-2 text-[11px] font-semibold uppercase tracking-wide"
          style={{ background: "var(--slip-surface-2)", color: "var(--slip-gold)" }}
        >
          Nice
        </button>
      </div>
    </div>
  );
}

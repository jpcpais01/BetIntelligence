"use client";

import { useEffect, useRef, useState } from "react";
import type { Game, IndependentPrediction, ComparisonResult } from "@/lib/types";
import Avatar from "./Avatar";
import EdgeChip from "./EdgeChip";
import { CloseIcon, TrendingUpIcon, BookmarkIcon } from "./icons";
import { formatKickoff, formatCostUsd } from "@/lib/format";
import { savePick } from "@/lib/picks";
import { saveLastAnalysis } from "@/lib/lastAnalysis";
import { loadSelectedModel } from "@/lib/models";

type GameStage = "pending" | "predicting" | "comparing" | "done" | "error";

interface GameResult {
  stage: GameStage;
  independent?: IndependentPrediction;
  comparison?: ComparisonResult;
  error?: string;
  saved?: boolean;
}

// Both sides can be missing (mock mode, or a provider that doesn't report cost) — only treat the
// total as "unknown" when neither side has a real number, rather than silently showing $0.00.
function totalCost(a?: number, b?: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

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

export default function BatchAnalysisSheet({
  games,
  onClose,
}: {
  games: Game[];
  onClose: () => void;
}) {
  const [results, setResults] = useState<Record<string, GameResult>>(() =>
    Object.fromEntries(games.map((g) => [g.id, { stage: "pending" as GameStage }]))
  );
  const [currentIdx, setCurrentIdx] = useState(0);
  // Guards against React's dev-mode double-invoked effect running the whole sequential batch
  // twice in parallel — no cleanup/cancellation needed since there's nothing to cancel into.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const model = loadSelectedModel();

    (async () => {
      for (let i = 0; i < games.length; i++) {
        const game = games[i];
        setCurrentIdx(i);
        setResults((r) => ({ ...r, [game.id]: { stage: "predicting" } }));

        try {
          const { prediction } = await postJson<{ prediction: IndependentPrediction }>(
            "/api/analyze/predict",
            {
              homeTeam: game.homeTeam,
              awayTeam: game.awayTeam,
              leagueName: game.leagueName,
              startTime: game.startTime,
              model,
            },
            "Analysis failed."
          );
          setResults((r) => ({ ...r, [game.id]: { stage: "comparing", independent: prediction } }));

          const { comparison } = await postJson<{ comparison: ComparisonResult }>(
            "/api/analyze/compare",
            {
              homeTeam: game.homeTeam,
              awayTeam: game.awayTeam,
              leagueName: game.leagueName,
              independent: prediction,
              market: game.odds,
              model,
            },
            "Comparison failed."
          );
          setResults((r) => ({ ...r, [game.id]: { stage: "done", independent: prediction, comparison } }));
          saveLastAnalysis(game.id, {
            analyzedAt: new Date().toISOString(),
            market: game.odds,
            independent: prediction,
            comparison,
            totalCostUsd: totalCost(prediction.costUsd, comparison.costUsd),
          });
        } catch (err) {
          setResults((r) => ({
            ...r,
            [game.id]: { stage: "error", error: err instanceof Error ? err.message : "Something went wrong." },
          }));
        }
      }
    })();
    // Intentionally runs once against the games list this sheet was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneCount = Object.values(results).filter((r) => r.stage === "done" || r.stage === "error").length;
  const allDone = doneCount === games.length;

  const handleSave = (game: Game) => {
    const r = results[game.id];
    if (!r?.independent || !r?.comparison) return;
    savePick({
      id: game.id,
      savedAt: new Date().toISOString(),
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      leagueName: game.leagueName,
      leagueFlag: game.leagueFlag,
      startTime: game.startTime,
      market: game.odds,
      independent: r.independent,
      comparison: r.comparison,
      totalCostUsd: totalCost(r.independent.costUsd, r.comparison.costUsd),
      tokenIds: game.tokenIds,
    });
    setResults((cur) => ({ ...cur, [game.id]: { ...cur[game.id], saved: true } }));
  };

  const handleSaveAll = () => {
    for (const game of games) {
      const r = results[game.id];
      if (r?.stage === "done" && !r.saved) handleSave(game);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={allDone ? onClose : undefined} />

      <div className="sheet-up relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-border-soft bg-bg-elevated sm:max-w-lg sm:rounded-3xl sm:border">
        <div className="shrink-0 border-b border-border-soft px-5 pb-3.5 pt-3">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border sm:hidden" />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-text">
                {allDone ? "Batch analysis complete" : `Analyzing ${currentIdx + 1} of ${games.length}`}
              </p>
              <p className="text-[11px] text-text-faint">{doneCount}/{games.length} finished</p>
            </div>
            {allDone && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="press shrink-0 rounded-full p-2 text-text-faint hover:bg-surface-2"
              >
                <CloseIcon className="h-4.5 w-4.5" />
              </button>
            )}
          </div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${(doneCount / games.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {games.map((game) => {
            const r = results[game.id] ?? { stage: "pending" as GameStage };
            return <BatchResultCard key={game.id} game={game} result={r} onSave={() => handleSave(game)} />;
          })}

          {allDone && (
            <button
              onClick={handleSaveAll}
              className="press flex w-full items-center justify-center gap-2 rounded-2xl border border-border-soft bg-surface py-3.5 text-[13px] font-semibold text-text"
            >
              <BookmarkIcon className="h-4 w-4" />
              Save all to Picks
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BatchResultCard({
  game,
  result,
  onSave,
}: {
  game: Game;
  result: GameResult;
  onSave: () => void;
}) {
  const { label: kickoffLabel } = formatKickoff(game.startTime);

  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-faint">
          <span>{game.leagueFlag}</span>
          <span className="truncate">
            {game.leagueName} &middot; {kickoffLabel}
          </span>
        </div>
        <StatusPill stage={result.stage} />
      </div>

      <div className="mb-3 flex items-center gap-2">
        <Avatar name={game.homeTeam} size={20} />
        <span className="truncate text-[13px] font-medium">{game.homeTeam}</span>
        <span className="shrink-0 text-[11px] text-text-faint">v</span>
        <span className="truncate text-[13px] font-medium">{game.awayTeam}</span>
        <Avatar name={game.awayTeam} size={20} />
      </div>

      {(result.stage === "pending" || result.stage === "predicting" || result.stage === "comparing") && (
        <div className="flex items-center gap-2 text-[12px] text-text-faint">
          <span className={`h-1.5 w-1.5 rounded-full bg-accent ${result.stage !== "pending" ? "pulse-dot" : "opacity-30"}`} />
          {result.stage === "pending"
            ? "Queued"
            : result.stage === "predicting"
              ? "Researching independently..."
              : "Comparing to the market..."}
        </div>
      )}

      {result.stage === "error" && <p className="selectable text-[12px] text-accent-3">{result.error}</p>}

      {result.stage === "done" && result.independent && result.comparison && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-3 gap-1.5">
            <MiniBar label={firstWord(game.homeTeam)} pct={result.independent.home} color="home" />
            <MiniBar label="Draw" pct={result.independent.draw} color="draw" />
            <MiniBar label={firstWord(game.awayTeam)} pct={result.independent.away} color="away" />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <EdgeChip label={firstWord(game.homeTeam)} edge={result.comparison.edges.home} />
            <EdgeChip label="Draw" edge={result.comparison.edges.draw} />
            <EdgeChip label={firstWord(game.awayTeam)} edge={result.comparison.edges.away} />
          </div>
          {result.comparison.bestValue !== "none" && (
            <div className="flex items-center gap-2 rounded-xl bg-accent/8 px-3 py-2 ring-1 ring-inset ring-accent/20">
              <TrendingUpIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
              <p className="text-[11px] text-text-dim">
                <span className="font-medium text-accent">
                  {result.comparison.bestValue === "draw"
                    ? "Draw"
                    : result.comparison.bestValue === "home"
                      ? game.homeTeam
                      : game.awayTeam}
                </span>{" "}
                flagged as value
              </p>
            </div>
          )}
          {formatCostUsd(totalCost(result.independent.costUsd, result.comparison.costUsd)) && (
            <p className="text-center text-[10px] tabular-nums text-text-faint">
              Cost: {formatCostUsd(totalCost(result.independent.costUsd, result.comparison.costUsd))}
            </p>
          )}
          <button
            onClick={onSave}
            disabled={result.saved}
            className="press flex w-full items-center justify-center gap-1.5 rounded-xl border border-border-soft bg-surface-2 py-2 text-xs font-semibold text-text disabled:opacity-60"
          >
            <BookmarkIcon className="h-3.5 w-3.5" filled={!!result.saved} />
            {result.saved ? "Saved" : "Save pick"}
          </button>
        </div>
      )}
    </div>
  );
}

function firstWord(name: string): string {
  return name.split(" ")[0];
}

function MiniBar({ label, pct, color }: { label: string; pct: number; color: "home" | "draw" | "away" }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-2 text-center">
      <p className="truncate text-[10px] text-text-faint">{label}</p>
      <p className="font-display text-[14px] font-semibold tabular-nums" style={{ color: `var(--${color})` }}>
        {Math.round(pct * 100)}%
      </p>
    </div>
  );
}

function StatusPill({ stage }: { stage: GameStage }) {
  const map: Record<GameStage, { label: string; cls: string }> = {
    pending: { label: "Queued", cls: "bg-surface-2 text-text-faint" },
    predicting: { label: "Analyzing", cls: "bg-accent/10 text-accent" },
    comparing: { label: "Comparing", cls: "bg-accent/10 text-accent" },
    done: { label: "Done", cls: "bg-accent/10 text-accent" },
    error: { label: "Failed", cls: "bg-accent-3/10 text-accent-3" },
  };
  const s = map[stage];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>;
}

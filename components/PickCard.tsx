import type { SavedPick, Probabilities } from "@/lib/types";
import type { LiveScoreEntry } from "@/lib/liveScores";
import { formatKickoff, formatCountdown, toSignedPercent } from "@/lib/format";
import { hasKickedOff, isMatchOver, retentionCountdown } from "@/lib/matchClock";
import Avatar from "./Avatar";
import { TrendingUpIcon, ScaleIcon, CloseIcon, ChevronRightIcon } from "./icons";

export default function PickCard({
  pick,
  onRemove,
  onOpen,
  liveScore,
  liveOdds,
}: {
  pick: SavedPick;
  onRemove: (id: string) => void;
  onOpen: (pick: SavedPick) => void;
  liveScore?: LiveScoreEntry | null;
  // CLOB's real current price once this pick's match has kicked off (app/picks/page.tsx) — the
  // same live-odds mechanism GameCard uses on Sports. Falls back to the plain snapshot the pick
  // was saved with for anything not yet live.
  liveOdds?: Probabilities | null;
}) {
  const { label: kickoffLabel } = formatKickoff(pick.startTime);
  const started = hasKickedOff(pick.startTime);
  const effectiveOdds = liveOdds ?? pick.market;

  const scoreLabel = liveScore
    ? `${liveScore.clockLabel ?? (liveScore.status === "FINISHED" ? "FT" : "LIVE")} ${liveScore.homeGoals ?? "-"}-${liveScore.awayGoals ?? "-"}`
    : null;
  const isLive = liveScore ? liveScore.status === "IN_PLAY" || liveScore.status === "PAUSED" : false;

  // The card's own look changes across the same three phases GameCard uses on Sports — upcoming
  // (the default treatment), live (a thicker, more saturated border + a more transparent/glassy
  // interior), and finished (muted/flattened, still worth a glance for the final score). A saved
  // pick stays on this list through all three, only actually pruned a full day after its match
  // ends (lib/picks.ts's pruneFinishedPicks, lib/matchClock.ts's retention window).
  const over = isMatchOver(pick.startTime, liveScore?.status);
  const phase: "upcoming" | "live" | "finished" = over ? "finished" : started ? "live" : "upcoming";
  const cardClassName =
    phase === "live"
      ? "border-2 border-accent-3/30 bg-surface/40 backdrop-blur-md"
      : phase === "finished"
        ? "border border-border-soft/60 bg-surface-2/40 opacity-75"
        : "border border-border-soft bg-surface";

  // How close this pick is to actually disappearing (lib/picks.ts's pruneFinishedPicks) — shown
  // as a shrinking bar rather than a bare number so it reads as something actively counting down,
  // not just another static stat next to it.
  const countdown = phase === "finished" ? retentionCountdown(pick.startTime) : null;

  const bestEdgeLabel =
    pick.comparison.bestValue === "none"
      ? null
      : pick.comparison.bestValue === "home"
        ? pick.homeTeam
        : pick.comparison.bestValue === "away"
          ? pick.awayTeam
          : "Draw";

  const bestEdgeValue =
    pick.comparison.bestValue === "none" ? 0 : pick.comparison.edges[pick.comparison.bestValue];

  return (
    <div
      onClick={() => onOpen(pick)}
      className={`press rise-in cursor-pointer rounded-2xl p-4 transition-colors ${cardClassName}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-faint">
          <span className="text-xs leading-none">{pick.leagueFlag}</span>
          <span className="truncate">{pick.leagueName}</span>
          {pick.research && pick.research.runCount > 1 && (
            <>
              <span className="opacity-50">&middot;</span>
              <span className="shrink-0 text-accent">{pick.research.runCount}&times; researched</span>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`text-[11px] tabular-nums ${isLive ? "font-medium text-accent-3" : "text-text-faint"}`}>
            {isLive && <span className="pulse-dot mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent-3 align-middle" />}
            {scoreLabel ?? kickoffLabel}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(pick.id);
            }}
            aria-label="Remove pick"
            className="press -mr-1 rounded-full p-1.5 text-text-faint hover:bg-surface-2 hover:text-accent-3"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
          <ChevronRightIcon className="h-3.5 w-3.5 text-text-faint" />
        </div>
      </div>

      <div className="mb-3.5 flex items-center gap-2">
        <Avatar name={pick.homeTeam} size={22} />
        <span className="truncate text-[13px] font-medium">{pick.homeTeam}</span>
        <span className="shrink-0 text-[11px] text-text-faint">v</span>
        <span className="truncate text-[13px] font-medium">{pick.awayTeam}</span>
        <Avatar name={pick.awayTeam} size={22} />
      </div>

      <div className="mb-3 grid grid-cols-3 gap-1.5">
        <MiniStat label={pick.homeTeam.split(" ")[0]} ai={pick.independent.home} market={effectiveOdds.home} />
        <MiniStat label="Draw" ai={pick.independent.draw} market={effectiveOdds.draw} />
        <MiniStat label={pick.awayTeam.split(" ")[0]} ai={pick.independent.away} market={effectiveOdds.away} />
      </div>

      {bestEdgeLabel ? (
        <div className="flex items-center gap-2 rounded-xl bg-accent/8 px-3 py-2 ring-1 ring-inset ring-accent/20">
          <TrendingUpIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
          <p className="truncate text-[11px] text-text-dim">
            <span className="font-medium text-accent">{bestEdgeLabel}</span> &middot;{" "}
            <span className="tabular-nums">{toSignedPercent(bestEdgeValue)}</span> edge
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
          <ScaleIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          <p className="text-[11px] text-text-dim">Market looked efficient.</p>
        </div>
      )}

      {countdown && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              key={`${pick.id}-${Math.round(countdown.elapsedFraction * 100)}`}
              className="countdown-drain h-full rounded-full bg-text-faint/60"
              style={{
                width: `${(1 - countdown.elapsedFraction) * 100}%`,
                animationDuration: `${countdown.remainingMs}ms`,
              }}
            />
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-text-faint">
            Fades in {formatCountdown(countdown.remainingMs)}
          </span>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, ai, market }: { label: string; ai: number; market: number }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-2 text-center">
      <p className="truncate text-[10px] text-text-faint">{label}</p>
      <p className="font-display text-[15px] font-semibold tabular-nums text-text">
        {Math.round(ai * 100)}%
      </p>
      <p className="text-[10px] tabular-nums text-text-faint">mkt {Math.round(market * 100)}%</p>
    </div>
  );
}

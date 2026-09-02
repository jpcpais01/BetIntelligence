import type { Game } from "@/lib/types";
import { formatCompactNumber, formatKickoff } from "@/lib/format";
import { isTopGame } from "@/lib/topTeams";
import Avatar from "./Avatar";
import OutcomeBar from "./OutcomeBar";
import { SparkleIcon, StarIcon } from "./icons";

export default function GameCard({
  game,
  onAnalyze,
  style,
}: {
  game: Game;
  onAnalyze: (game: Game) => void;
  style?: React.CSSProperties;
}) {
  const { label: kickoffLabel, isLive } = formatKickoff(game.startTime);
  const top = isTopGame(game);

  return (
    <div
      className={`rise-in rounded-3xl border bg-surface/70 backdrop-blur p-4 sm:p-5 ${
        top ? "border-warn/30" : "border-border-soft"
      }`}
      style={style}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-dim">
            <span className="text-sm leading-none">{game.leagueFlag}</span>
            {game.leagueName}
          </span>
          {top && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-1 text-[11px] font-semibold text-warn">
              <StarIcon className="h-3 w-3" filled />
              Top
            </span>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            isLive ? "bg-accent-3/15 text-accent-3" : "bg-surface-2 text-text-faint"
          }`}
        >
          {isLive && <span className="h-1.5 w-1.5 rounded-full bg-accent-3 pulse-dot" />}
          {kickoffLabel}
        </span>
      </div>

      <div className="space-y-2.5 mb-4">
        <div className="flex items-center gap-3">
          <Avatar name={game.homeTeam} size={28} />
          <div className="flex-1 min-w-0">
            <OutcomeBar label={game.homeTeam} pct={game.odds.home} color="home" size="sm" />
          </div>
        </div>

        <div className="flex items-center gap-2 pl-[40px] py-0.5">
          <span className="text-[10px] font-semibold tracking-wide text-text-faint shrink-0">DRAW</span>
          <div className="h-1 flex-1 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full rounded-full grow-bar"
              style={{ width: `${game.odds.draw * 100}%`, background: "var(--draw)" }}
            />
          </div>
          <span className="text-[10px] font-semibold text-text-faint shrink-0">
            {Math.round(game.odds.draw * 100)}%
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Avatar name={game.awayTeam} size={28} />
          <div className="flex-1 min-w-0">
            <OutcomeBar label={game.awayTeam} pct={game.odds.away} color="away" size="sm" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border-soft pt-3">
        <span className="text-[11px] text-text-faint">
          ${formatCompactNumber(game.volume)} volume
        </span>
        <button
          onClick={() => onAnalyze(game)}
          className="group inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-accent to-accent-2 px-4 py-2 text-xs font-semibold text-bg transition active:scale-95"
          style={{ boxShadow: "0 0 20px -6px rgba(52,227,154,0.6)" }}
        >
          <SparkleIcon className="h-3.5 w-3.5 sparkle-spin" />
          AI Analyze
        </button>
      </div>
    </div>
  );
}

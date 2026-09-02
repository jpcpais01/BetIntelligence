import type { Game } from "@/lib/types";
import { formatCompactNumber, formatKickoff } from "@/lib/format";
import { isTopGame } from "@/lib/topTeams";
import Avatar from "./Avatar";
import OutcomeBar from "./OutcomeBar";
import { SparkleIcon, StarIcon, CheckIcon } from "./icons";

export default function GameCard({
  game,
  onAnalyze,
  style,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  game: Game;
  onAnalyze: (game: Game) => void;
  style?: React.CSSProperties;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (game: Game) => void;
}) {
  const { label: kickoffLabel, isLive } = formatKickoff(game.startTime);
  const top = isTopGame(game);

  return (
    <div
      onClick={selectMode ? () => onToggleSelect?.(game) : undefined}
      className={`rise-in rounded-2xl border p-4 ${
        selectMode
          ? `cursor-pointer press ${selected ? "border-accent/40 bg-accent/6" : "border-border-soft bg-surface"}`
          : "border-border-soft bg-surface"
      }`}
      style={style}
    >
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
        </div>
        <span
          className={`shrink-0 text-[11px] tabular-nums ${isLive ? "font-medium text-accent-3" : "text-text-faint"}`}
        >
          {isLive && <span className="pulse-dot mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent-3 align-middle" />}
          {kickoffLabel}
        </span>
      </div>

      <div className="mb-4 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <Avatar name={game.homeTeam} size={26} />
          <div className="min-w-0 flex-1">
            <OutcomeBar label={game.homeTeam} pct={game.odds.home} color="home" size="sm" />
          </div>
        </div>

        <div className="flex items-center gap-2 pl-[36px]">
          <span className="shrink-0 text-[11px] text-text-faint">Draw</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="grow-bar h-full rounded-full"
              style={{ width: `${game.odds.draw * 100}%`, background: "var(--draw)", opacity: 0.9 }}
            />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-text-faint">
            {Math.round(game.odds.draw * 100)}%
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <Avatar name={game.awayTeam} size={26} />
          <div className="min-w-0 flex-1">
            <OutcomeBar label={game.awayTeam} pct={game.odds.away} color="away" size="sm" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border-soft pt-3">
        <span className="text-[11px] tabular-nums text-text-faint">
          ${formatCompactNumber(game.volume)} vol
        </span>
        {!selectMode && (
          <button
            onClick={() => onAnalyze(game)}
            className="press inline-flex items-center gap-1.5 rounded-full bg-accent/12 px-3.5 py-2 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/25 hover:bg-accent/18"
          >
            <SparkleIcon className="h-3.5 w-3.5" />
            Analyze
          </button>
        )}
      </div>
    </div>
  );
}

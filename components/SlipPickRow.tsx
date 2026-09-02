import type { SavedPick } from "@/lib/types";
import type { Outcome } from "@/lib/betslip";
import { toPercent } from "@/lib/format";
import Avatar from "./Avatar";

const OUTCOME_COLOR: Record<Outcome, string> = {
  home: "var(--home)",
  draw: "var(--draw)",
  away: "var(--away)",
};

export default function SlipPickRow({
  pick,
  selectedOutcome,
  onPick,
}: {
  pick: SavedPick;
  selectedOutcome: Outcome | null;
  onPick: (outcome: Outcome) => void;
}) {
  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-3.5">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] text-text-faint">
        <span>{pick.leagueFlag}</span>
        <span className="truncate">{pick.leagueName}</span>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <Avatar name={pick.homeTeam} size={20} />
        <span className="truncate text-[13px] font-medium">{pick.homeTeam}</span>
        <span className="shrink-0 text-[11px] text-text-faint">v</span>
        <span className="truncate text-[13px] font-medium">{pick.awayTeam}</span>
        <Avatar name={pick.awayTeam} size={20} />
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <OutcomeButton
          label={firstWord(pick.homeTeam)}
          outcome="home"
          ai={pick.independent.home}
          market={pick.market.home}
          active={selectedOutcome === "home"}
          onClick={() => onPick("home")}
        />
        <OutcomeButton
          label="Draw"
          outcome="draw"
          ai={pick.independent.draw}
          market={pick.market.draw}
          active={selectedOutcome === "draw"}
          onClick={() => onPick("draw")}
        />
        <OutcomeButton
          label={firstWord(pick.awayTeam)}
          outcome="away"
          ai={pick.independent.away}
          market={pick.market.away}
          active={selectedOutcome === "away"}
          onClick={() => onPick("away")}
        />
      </div>
    </div>
  );
}

function firstWord(name: string): string {
  return name.split(" ")[0];
}

function OutcomeButton({
  label,
  outcome,
  ai,
  market,
  active,
  onClick,
}: {
  label: string;
  outcome: Outcome;
  ai: number;
  market: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`press rounded-xl px-2 py-2 text-center ring-1 ring-inset ${
        active ? "bg-surface-2 ring-2" : "bg-surface-2/60 ring-border-soft"
      }`}
      style={active ? { boxShadow: `inset 0 0 0 1.5px ${OUTCOME_COLOR[outcome]}` } : undefined}
    >
      <p className="truncate text-[10px] text-text-faint">{label}</p>
      <p className="font-display text-[14px] font-semibold tabular-nums" style={{ color: OUTCOME_COLOR[outcome] }}>
        {toPercent(ai)}
      </p>
      <p className="text-[10px] tabular-nums text-text-faint">mkt {toPercent(market)}</p>
    </button>
  );
}

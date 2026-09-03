import type { SavedPick } from "@/lib/types";
import type { Outcome } from "@/lib/betslip";
import { toPercent } from "@/lib/format";
import Avatar from "./Avatar";
import { ChevronRightIcon } from "./icons";

const OUTCOME_COLOR: Record<"home" | "draw" | "away", string> = {
  home: "var(--home)",
  draw: "var(--draw)",
  away: "var(--away)",
};

export default function SlipPickRow({
  pick,
  selectedOutcome,
  onPick,
  onOpen,
}: {
  pick: SavedPick;
  // The slip stores the resolved display label (team name / "Draw"), not the raw enum — this
  // component compares against that label to decide which button is highlighted, but still
  // reports the Outcome enum to onPick since that's what legFromPick needs to index into
  // pick.market/pick.independent.
  selectedOutcome: string | null;
  onPick: (outcome: Outcome) => void;
  onOpen: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-3.5">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] text-text-faint">
        <span>{pick.leagueFlag}</span>
        <span className="truncate">{pick.leagueName}</span>
      </div>

      <button onClick={onOpen} className="press mb-3 flex w-full items-center gap-2 text-left">
        <Avatar name={pick.homeTeam} size={20} />
        <span className="truncate text-[13px] font-medium">{pick.homeTeam}</span>
        <span className="shrink-0 text-[11px] text-text-faint">v</span>
        <span className="truncate text-[13px] font-medium">{pick.awayTeam}</span>
        <Avatar name={pick.awayTeam} size={20} />
        <ChevronRightIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-text-faint" />
      </button>

      <div className="grid grid-cols-3 gap-1.5">
        <OutcomeButton
          label={firstWord(pick.homeTeam)}
          outcome="home"
          ai={pick.independent.home}
          market={pick.market.home}
          active={selectedOutcome === pick.homeTeam}
          onClick={() => onPick("home")}
        />
        <OutcomeButton
          label="Draw"
          outcome="draw"
          ai={pick.independent.draw}
          market={pick.market.draw}
          active={selectedOutcome === "Draw"}
          onClick={() => onPick("draw")}
        />
        <OutcomeButton
          label={firstWord(pick.awayTeam)}
          outcome="away"
          ai={pick.independent.away}
          market={pick.market.away}
          active={selectedOutcome === pick.awayTeam}
          onClick={() => onPick("away")}
        />
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <ComboButton
          label="1X"
          sublabel={`${firstWord(pick.homeTeam)} or draw`}
          ai={pick.independent.home + pick.independent.draw}
          market={pick.market.home + pick.market.draw}
          active={selectedOutcome === "1X"}
          onClick={() => onPick("1x")}
        />
        <ComboButton
          label="X2"
          sublabel={`Draw or ${firstWord(pick.awayTeam)}`}
          ai={pick.independent.draw + pick.independent.away}
          market={pick.market.draw + pick.market.away}
          active={selectedOutcome === "X2"}
          onClick={() => onPick("x2")}
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
  outcome: "home" | "draw" | "away";
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

// Double chance (1X / X2): two of the three 1X2 outcomes bet together, so it gets a visually
// distinct compact row rather than sitting inside the main 3-way grid as if it were a fourth
// independent side.
function ComboButton({
  label,
  sublabel,
  ai,
  market,
  active,
  onClick,
}: {
  label: string;
  sublabel: string;
  ai: number;
  market: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`press flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left ring-1 ring-inset ${
        active ? "bg-accent-2/12 ring-accent-2" : "bg-surface-2/60 ring-border-soft"
      }`}
    >
      <div className="min-w-0">
        <p className={`text-[11px] font-semibold ${active ? "text-accent-2" : "text-text-dim"}`}>{label}</p>
        <p className="truncate text-[9px] text-text-faint">{sublabel}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-display text-[12px] font-semibold tabular-nums text-accent-2">{toPercent(ai)}</p>
        <p className="text-[9px] tabular-nums text-text-faint">mkt {toPercent(market)}</p>
      </div>
    </button>
  );
}

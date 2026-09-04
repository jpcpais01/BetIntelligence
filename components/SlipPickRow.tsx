import type { SavedPick } from "@/lib/types";
import type { Outcome } from "@/lib/betslip";
import { liveKey } from "@/lib/livePrices";
import { toPercent, toSignedPercent, toDecimalOdds } from "@/lib/format";
import Avatar from "./Avatar";
import { ChevronRightIcon, BoltIcon } from "./icons";

// A meaningfully positive AI-vs-market edge earns a small "value" badge — the whole point of a
// gamified slip is making a spottable edge feel like a find, not just another number in a row.
// It's the only place edge shows: a number on every single button, value or not, is just noise.
const VALUE_EDGE_THRESHOLD = 0.02;

const OUTCOME_COLOR: Record<"home" | "draw" | "away" | "combo", string> = {
  home: "var(--lab-pink)",
  draw: "var(--lab-gold)",
  away: "var(--lab-cyan)",
  combo: "var(--lab-gold)",
};

export default function SlipPickRow({
  pick,
  livePrices,
  selectedOutcome,
  onPick,
  onOpen,
}: {
  pick: SavedPick;
  // Current market price per outcome, keyed by liveKey(pick.id, outcomeLabel) — falls back to
  // this pick's own analysis-time snapshot (pick.market) wherever a key is missing (no tokenId on
  // this pick, or the fetch hasn't landed yet).
  livePrices: Record<string, number>;
  // The slip stores the resolved display label (team name / "Draw"), not the raw enum — this
  // component compares against that label to decide which button is highlighted, but still
  // reports the Outcome enum to onPick since that's what legFromPick needs to index into
  // pick.market/pick.independent.
  selectedOutcome: string | null;
  onPick: (outcome: Outcome) => void;
  onOpen: () => void;
}) {
  const liveHome = livePrices[liveKey(pick.id, pick.homeTeam)] ?? pick.market.home;
  const liveDraw = livePrices[liveKey(pick.id, "Draw")] ?? pick.market.draw;
  const liveAway = livePrices[liveKey(pick.id, pick.awayTeam)] ?? pick.market.away;

  return (
    <div className="rounded-2xl p-2.5" style={{ background: "var(--lab-surface)", border: "1px solid var(--lab-border)" }}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-text-faint">
        <span>{pick.leagueFlag}</span>
        <span className="truncate">{pick.leagueName}</span>
      </div>

      <button onClick={onOpen} className="press mb-2 flex w-full items-center gap-1.5 text-left">
        <Avatar name={pick.homeTeam} size={18} />
        <span className="truncate text-[12px] font-medium text-text">{pick.homeTeam}</span>
        <span className="shrink-0 text-[10px] text-text-faint">v</span>
        <span className="truncate text-[12px] font-medium text-text">{pick.awayTeam}</span>
        <Avatar name={pick.awayTeam} size={18} />
        <ChevronRightIcon className="ml-auto h-3 w-3 shrink-0 text-text-faint" />
      </button>

      <div className="grid grid-cols-3 gap-1">
        <OddsButton
          label={firstWord(pick.homeTeam)}
          color={OUTCOME_COLOR.home}
          ai={pick.independent.home}
          market={liveHome}
          active={selectedOutcome === pick.homeTeam}
          onClick={() => onPick("home")}
        />
        <OddsButton
          label="Draw"
          color={OUTCOME_COLOR.draw}
          ai={pick.independent.draw}
          market={liveDraw}
          active={selectedOutcome === "Draw"}
          onClick={() => onPick("draw")}
        />
        <OddsButton
          label={firstWord(pick.awayTeam)}
          color={OUTCOME_COLOR.away}
          ai={pick.independent.away}
          market={liveAway}
          active={selectedOutcome === pick.awayTeam}
          onClick={() => onPick("away")}
        />
      </div>

      <div className="mt-1 grid grid-cols-2 gap-1">
        <OddsButton
          label="1X"
          color={OUTCOME_COLOR.combo}
          ai={pick.independent.home + pick.independent.draw}
          market={liveHome + liveDraw}
          active={selectedOutcome === "1X"}
          onClick={() => onPick("1x")}
        />
        <OddsButton
          label="X2"
          color={OUTCOME_COLOR.combo}
          ai={pick.independent.draw + pick.independent.away}
          market={liveDraw + liveAway}
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

// One shared button style for all five outcomes (home/draw/away plus the two double-chance
// combos) — a single consistent shape reads faster than switching layouts partway down the card.
// Edge only ever shows as the corner badge, and only when it's actually worth noticing.
function OddsButton({
  label,
  color,
  ai,
  market,
  active,
  onClick,
}: {
  label: string;
  color: string;
  ai: number;
  market: number;
  active: boolean;
  onClick: () => void;
}) {
  const edge = ai - market;
  const isValue = edge >= VALUE_EDGE_THRESHOLD;
  return (
    <button
      onClick={onClick}
      className="press relative rounded-xl px-1.5 py-1.5 text-center"
      style={{
        background: active ? "var(--lab-surface-2)" : "rgba(255,255,255,0.03)",
        boxShadow: active ? `inset 0 0 0 1.5px ${color}` : "inset 0 0 0 1px var(--lab-border)",
      }}
    >
      {isValue && (
        <span
          className="absolute -top-1 -right-1 flex items-center gap-0.5 rounded-full px-1 py-0.5 text-[7px] font-bold"
          style={{ background: "var(--lab-green)", color: "#052018" }}
        >
          <BoltIcon className="h-1.5 w-1.5" />
          {toSignedPercent(edge)}
        </span>
      )}
      <p className="truncate text-[9px] text-text-faint">{label}</p>
      <p className="flex items-baseline justify-center gap-1">
        <span className="font-display text-[15px] font-bold tabular-nums" style={{ color }}>
          {toDecimalOdds(market)}
        </span>
        <span className="text-[9px] font-medium tabular-nums text-text-faint">{toPercent(market)}</span>
      </p>
      <p className="text-[8px] tabular-nums text-text-faint">AI {toPercent(ai)}</p>
    </button>
  );
}

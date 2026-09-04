import type { SavedPick } from "@/lib/types";
import type { Outcome } from "@/lib/betslip";
import { liveKey } from "@/lib/livePrices";
import { toPercent, toSignedPercent, toDecimalOdds } from "@/lib/format";
import Avatar from "./Avatar";
import { ChevronRightIcon, BoltIcon } from "./icons";

// A meaningfully positive AI-vs-market edge earns a small "value" badge — the whole point of a
// gamified slip is making a spottable edge feel like a find, not just another number in a row.
const VALUE_EDGE_THRESHOLD = 0.02;

const OUTCOME_COLOR: Record<"home" | "draw" | "away", string> = {
  home: "var(--lab-pink)",
  draw: "var(--lab-gold)",
  away: "var(--lab-cyan)",
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
    <div className="rounded-3xl p-3.5" style={{ background: "var(--lab-surface)", border: "1px solid var(--lab-border)" }}>
      <div className="mb-2.5 flex items-center gap-2 text-[11px] text-text-faint">
        <span>{pick.leagueFlag}</span>
        <span className="truncate">{pick.leagueName}</span>
      </div>

      <button onClick={onOpen} className="press mb-3 flex w-full items-center gap-2 text-left">
        <Avatar name={pick.homeTeam} size={20} />
        <span className="truncate text-[13px] font-medium text-text">{pick.homeTeam}</span>
        <span className="shrink-0 text-[11px] text-text-faint">v</span>
        <span className="truncate text-[13px] font-medium text-text">{pick.awayTeam}</span>
        <Avatar name={pick.awayTeam} size={20} />
        <ChevronRightIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-text-faint" />
      </button>

      <div className="grid grid-cols-3 gap-1.5">
        <OutcomeButton
          label={firstWord(pick.homeTeam)}
          outcome="home"
          ai={pick.independent.home}
          entryMarket={pick.market.home}
          liveMarket={liveHome}
          active={selectedOutcome === pick.homeTeam}
          onClick={() => onPick("home")}
        />
        <OutcomeButton
          label="Draw"
          outcome="draw"
          ai={pick.independent.draw}
          entryMarket={pick.market.draw}
          liveMarket={liveDraw}
          active={selectedOutcome === "Draw"}
          onClick={() => onPick("draw")}
        />
        <OutcomeButton
          label={firstWord(pick.awayTeam)}
          outcome="away"
          ai={pick.independent.away}
          entryMarket={pick.market.away}
          liveMarket={liveAway}
          active={selectedOutcome === pick.awayTeam}
          onClick={() => onPick("away")}
        />
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <ComboButton
          label="1X"
          sublabel={`${firstWord(pick.homeTeam)} or draw`}
          ai={pick.independent.home + pick.independent.draw}
          entryMarket={pick.market.home + pick.market.draw}
          liveMarket={liveHome + liveDraw}
          active={selectedOutcome === "1X"}
          onClick={() => onPick("1x")}
        />
        <ComboButton
          label="X2"
          sublabel={`Draw or ${firstWord(pick.awayTeam)}`}
          ai={pick.independent.draw + pick.independent.away}
          entryMarket={pick.market.draw + pick.market.away}
          liveMarket={liveDraw + liveAway}
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

// Delta shows the drift between "edge as of the analysis" and "edge right now" — entirely
// captured by how much the market itself moved, since the AI's read is a fixed number from
// analysis time. Sign convention: positive delta means the edge has widened since analysis.
function edgeDelta(entryMarket: number, liveMarket: number): number {
  return entryMarket - liveMarket;
}

function OutcomeButton({
  label,
  outcome,
  ai,
  entryMarket,
  liveMarket,
  active,
  onClick,
}: {
  label: string;
  outcome: "home" | "draw" | "away";
  ai: number;
  entryMarket: number;
  liveMarket: number;
  active: boolean;
  onClick: () => void;
}) {
  const edge = ai - liveMarket;
  const delta = edgeDelta(entryMarket, liveMarket);
  const isValue = edge >= VALUE_EDGE_THRESHOLD;
  const color = OUTCOME_COLOR[outcome];
  return (
    <button
      onClick={onClick}
      className="press relative rounded-2xl px-2 py-2.5 text-center"
      style={{
        background: active ? "var(--lab-surface-2)" : "rgba(255,255,255,0.03)",
        boxShadow: active ? `inset 0 0 0 1.5px ${color}` : "inset 0 0 0 1px var(--lab-border)",
      }}
    >
      {isValue && (
        <span
          className="absolute -top-1.5 -right-1.5 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-bold"
          style={{ background: "var(--lab-green)", color: "#052018" }}
        >
          <BoltIcon className="h-2 w-2" />
          {toSignedPercent(edge)}
        </span>
      )}
      <p className="truncate text-[10px] text-text-faint">{label}</p>
      <p className="font-display text-[17px] font-bold tabular-nums" style={{ color }}>
        {toDecimalOdds(liveMarket)}
      </p>
      <p className="text-[9px] tabular-nums text-text-faint">AI {toPercent(ai)}</p>
      <p className="text-[7px] tabular-nums text-text-faint opacity-70">
        &Delta; {toSignedPercent(delta)} since analysis
      </p>
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
  entryMarket,
  liveMarket,
  active,
  onClick,
}: {
  label: string;
  sublabel: string;
  ai: number;
  entryMarket: number;
  liveMarket: number;
  active: boolean;
  onClick: () => void;
}) {
  // A double-chance edge is just the sum of the two 1X2 edges it covers (e.g. 1X's edge = the
  // home edge + the draw edge) — already true here since `ai`/`entryMarket`/`liveMarket` are
  // themselves sums of the two outcomes it covers.
  const edge = ai - liveMarket;
  const delta = edgeDelta(entryMarket, liveMarket);
  const isValue = edge >= VALUE_EDGE_THRESHOLD;
  return (
    <button
      onClick={onClick}
      className="press relative flex items-center justify-between gap-2 rounded-2xl px-2.5 py-1.5 text-left"
      style={{
        background: active ? "rgba(var(--lab-gold-rgb), 0.14)" : "rgba(255,255,255,0.03)",
        boxShadow: active ? "inset 0 0 0 1.5px var(--lab-gold)" : "inset 0 0 0 1px var(--lab-border)",
      }}
    >
      {isValue && (
        <span
          className="absolute -top-1.5 -right-1.5 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-bold"
          style={{ background: "var(--lab-green)", color: "#052018" }}
        >
          <BoltIcon className="h-2 w-2" />
          {toSignedPercent(edge)}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-[11px] font-semibold" style={{ color: active ? "var(--lab-gold)" : "var(--text-dim)" }}>
          {label}
        </p>
        <p className="truncate text-[9px] text-text-faint">{sublabel}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-display text-[13px] font-bold tabular-nums" style={{ color: "var(--lab-gold)" }}>
          {toDecimalOdds(liveMarket)}
        </p>
        <p className="text-[9px] tabular-nums text-text-faint">
          AI {toPercent(ai)} &middot;{" "}
          <span style={{ color: edge > 0.005 ? "var(--lab-green)" : edge < -0.005 ? "var(--lab-red)" : undefined }}>
            {toSignedPercent(edge)}
          </span>
        </p>
        <p className="text-[7px] tabular-nums text-text-faint opacity-70">&Delta; {toSignedPercent(delta)}</p>
      </div>
    </button>
  );
}

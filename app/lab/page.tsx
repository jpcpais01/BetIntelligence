"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SavedPick } from "@/lib/types";
import { pruneFinishedPicks } from "@/lib/picks";
import { hasKickedOff } from "@/lib/matchClock";
import { loadSlip, saveSlip, legFromPick, type SlipLeg, type Outcome } from "@/lib/betslip";
import { loadPlacedBets, removePlacedBet, type PlacedBet } from "@/lib/placedBets";
import { resolvePendingSettlements } from "@/lib/settlement";
import { buildCelebration, type Celebration } from "@/lib/celebration";
import { liveKey, fetchLivePrices, type LivePriceRequest } from "@/lib/livePrices";
import { RISK_MODES, buildRiskSlip, type RiskMode } from "@/lib/riskModes";
import SlipPickRow from "@/components/SlipPickRow";
import PlacedBetCard from "@/components/PlacedBetCard";
import BetSlipBar from "@/components/BetSlipBar";
import PickDetailSheet from "@/components/PickDetailSheet";
import WinCelebration from "@/components/WinCelebration";
import { useRequestLogos } from "@/components/ClubLogosProvider";
import { SearchIcon, TicketIcon, CoinsIcon } from "@/components/icons";

type Tab = "build" | "bets";

// Bets used to only ever get checked once, right when this page happened to mount — a match that
// finished while the tab sat open just stayed "Pending" until the next full reload. Rechecking on
// an interval means a bet settles on its own, the same way the Sports page's live scores do.
const SETTLEMENT_CHECK_INTERVAL_MS = 60_000;

// Discover (and its saved market picks) is deactivated for now — Build is football-only, with no
// All/Football filter since there's nothing else to filter between. Market picks already saved
// from before stay in storage untouched (lib/marketPicks.ts), just not read or shown here.
export default function LabPage() {
  const [sportsPicks, setSportsPicks] = useState<SavedPick[] | null>(null);
  const [placedBets, setPlacedBets] = useState<PlacedBet[] | null>(null);
  const [legs, setLegs] = useState<SlipLeg[]>([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("build");
  const [openPick, setOpenPick] = useState<SavedPick | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [riskError, setRiskError] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const requestLogos = useRequestLogos();

  // Mirrors `placedBets` so the recurring settlement check can always read the latest value
  // without depending on it directly — a direct dependency would tear down and restart the
  // interval every time a bet settles or is placed/removed, so it would never actually run every
  // SETTLEMENT_CHECK_INTERVAL_MS as intended (the same bug this session already fixed for the
  // Sports page's live-score/odds polling).
  const placedBetsRef = useRef<PlacedBet[] | null>(null);
  useEffect(() => {
    placedBetsRef.current = placedBets;
  }, [placedBets]);

  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const checkSettlements = useCallback(async (bets: PlacedBet[] | null) => {
    if (!bets || bets.length === 0) return;
    const { bets: settled, newlyWon } = await resolvePendingSettlements(bets);
    if (!mountedRef.current) return;
    setPlacedBets(settled);
    if (newlyWon.length > 0) {
      const c = await buildCelebration(newlyWon);
      if (mountedRef.current && c) setCelebration(c);
    }
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR */
    const loadedBets = loadPlacedBets();
    // A match already underway isn't buildable anymore — Lab is a "build a new bet" tool, not an
    // analysis archive (that's Picks, which still shows it until pruneFinishedPicks eventually
    // removes it outright).
    setSportsPicks(pruneFinishedPicks().filter((p) => !hasKickedOff(p.startTime)));
    const loadedLegs = loadSlip();
    const buildableLegs = loadedLegs.filter(
      (leg) => leg.kind !== "sports" || !leg.startTime || !hasKickedOff(leg.startTime)
    );
    if (buildableLegs.length !== loadedLegs.length) saveSlip(buildableLegs);
    setLegs(buildableLegs);
    setPlacedBets(loadedBets);
    /* eslint-enable react-hooks/set-state-in-effect */
    void checkSettlements(loadedBets);
  }, [checkSettlements]);

  // The recurring check reads bets via the ref (mirrored above), never as a direct effect
  // dependency — ticks on its own schedule regardless of how often `placedBets` itself changes.
  useEffect(() => {
    const id = setInterval(() => void checkSettlements(placedBetsRef.current), SETTLEMENT_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkSettlements]);

  useEffect(() => {
    if (!sportsPicks || sportsPicks.length === 0) return;
    requestLogos(sportsPicks.flatMap((p) => [p.homeTeam, p.awayTeam]));
  }, [sportsPicks, requestLogos]);

  const picks = sportsPicks;

  // Every picked outcome's live current price, keyed the same way a SlipLeg identifies itself
  // (liveKey) — one fetch serves the browsing rows below, the slip bar, and My Bets alike, all
  // reading from this same map. Missing keys (an old pick with no tokenId, or a fetch that hasn't
  // landed yet) fall back to that pick's own stored snapshot at each call site.
  useEffect(() => {
    if (!picks || picks.length === 0) return;
    const requests: LivePriceRequest[] = [];
    for (const p of picks) {
      requests.push({ key: liveKey(p.id, p.homeTeam), tokenId: p.tokenIds?.home, fallback: p.market.home });
      requests.push({ key: liveKey(p.id, "Draw"), tokenId: p.tokenIds?.draw, fallback: p.market.draw });
      requests.push({ key: liveKey(p.id, p.awayTeam), tokenId: p.tokenIds?.away, fallback: p.market.away });
    }
    let cancelled = false;
    fetchLivePrices(requests).then((result) => {
      if (!cancelled) setLivePrices(result);
    });
    return () => {
      cancelled = true;
    };
  }, [picks]);

  const filteredPicks = useMemo(() => {
    if (!picks) return [];
    const q = query.trim().toLowerCase();
    if (!q) return picks;
    return picks.filter(
      (p) =>
        p.homeTeam.toLowerCase().includes(q) ||
        p.awayTeam.toLowerCase().includes(q) ||
        p.leagueName.toLowerCase().includes(q)
    );
  }, [picks, query]);

  const legByPickId = useMemo(() => {
    const map = new Map<string, string>();
    for (const leg of legs) map.set(leg.pickId, leg.outcomeLabel);
    return map;
  }, [legs]);

  const upsertLeg = (pickId: string, newLeg: SlipLeg) => {
    setLegs((current) => {
      const existing = current.find((l) => l.pickId === pickId);
      let next: SlipLeg[];
      if (existing && existing.outcomeLabel === newLeg.outcomeLabel) {
        // Tapping the already-chosen outcome removes that leg.
        next = current.filter((l) => l.pickId !== pickId);
      } else if (existing) {
        next = current.map((l) => (l.pickId === pickId ? newLeg : l));
      } else {
        next = [...current, newLeg];
      }
      saveSlip(next);
      return next;
    });
  };

  const handlePickSports = (pick: SavedPick, outcome: Outcome) => upsertLeg(pick.id, legFromPick(pick, outcome));

  const handleRemove = (pickId: string) => {
    setLegs((current) => {
      const next = current.filter((l) => l.pickId !== pickId);
      saveSlip(next);
      return next;
    });
  };

  const handleClear = () => {
    setLegs([]);
    saveSlip([]);
  };

  // One-tap slip builder: replaces whatever's currently in the slip with an auto-picked set of
  // football legs for the chosen risk level (lib/riskModes.ts). Football-only, since 1X2/1X/X2 are
  // football concepts with no Discover-market equivalent.
  const handleRiskMode = (mode: RiskMode) => {
    const result = buildRiskSlip(sportsPicks ?? [], livePrices, mode);
    if (!result) {
      const label = RISK_MODES.find((m) => m.id === mode)?.label ?? mode;
      setRiskError(`Not enough games for ${label} mode.`);
      return;
    }
    setRiskError(null);
    setLegs(result);
    saveSlip(result);
  };

  return (
    <div className="lab mx-auto max-w-md">
      {/* A fixed full-viewport layer, independent of this page's own content height or the
          parent layout's bottom padding reserved for the BottomNav — either would otherwise
          leave a seam of the app's ordinary near-black background showing through beneath
          Lab's much lighter violet one. */}
      <div className="fixed inset-0 -z-10" style={{ background: "var(--lab-bg)" }} />
      <header
        className="lab-hero safe-top sticky top-0 z-30 space-y-3 px-4 pb-3 pt-3"
        style={{ borderBottom: "1px solid var(--lab-border)" }}
      >
        {tab === "build" && (
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search analyzed picks..."
              className="w-full rounded-full py-2.5 pl-9 pr-3 text-[13px] text-text placeholder:text-text-faint focus:outline-none"
              style={{ background: "var(--lab-surface-2)", boxShadow: "inset 0 0 0 1px var(--lab-border)" }}
            />
          </div>
        )}

        <div className="flex gap-1.5">
          <div className="flex flex-1 gap-1.5 rounded-full p-1" style={{ background: "var(--lab-surface-2)" }}>
            <TabButton label="Build" active={tab === "build"} onClick={() => setTab("build")} />
            <TabButton
              label="My Bets"
              count={placedBets?.length}
              active={tab === "bets"}
              onClick={() => setTab("bets")}
            />
          </div>
        </div>

        {tab === "build" && sportsPicks && sportsPicks.length > 0 && (
          <div className="flex gap-1.5">
            {RISK_MODES.map((mode) => (
              <RiskButton key={mode.id} mode={mode} onClick={() => handleRiskMode(mode.id)} />
            ))}
          </div>
        )}
        {riskError && <p className="text-[11px]" style={{ color: "var(--lab-red)" }}>{riskError}</p>}
      </header>

      <div className={`px-4 pt-4 ${legs.length > 0 ? "pb-28" : "pb-4"}`}>
        {tab === "build" ? (
          <>
            {picks === null && <div className="py-16" />}

            {picks !== null && picks.length === 0 && (
              <div
                className="flex flex-col items-center gap-2.5 rounded-3xl px-5 py-16 text-center"
                style={{ background: "var(--lab-surface)", border: "1px solid var(--lab-border)" }}
              >
                <TicketIcon className="h-6 w-6" style={{ color: "var(--lab-gold)" }} />
                <p className="max-w-[240px] text-[13px] text-text-dim">
                  Analyze a match and save it as a pick, then stack it into a slip here.
                </p>
              </div>
            )}

            {picks !== null && picks.length > 0 && filteredPicks.length === 0 && (
              <p className="py-10 text-center text-[13px] text-text-faint">
                {query ? `No analyzed picks match "${query}".` : "No football picks saved yet."}
              </p>
            )}

            {filteredPicks.length > 0 && (
              <div className="space-y-3">
                {filteredPicks.map((pick) => (
                  <SlipPickRow
                    key={pick.id}
                    pick={pick}
                    livePrices={livePrices}
                    selectedOutcome={legByPickId.get(pick.id) ?? null}
                    onPick={(outcome) => handlePickSports(pick, outcome)}
                    onOpen={() => setOpenPick(pick)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {placedBets === null && <div className="py-16" />}

            {placedBets !== null && placedBets.length === 0 && (
              <div
                className="flex flex-col items-center gap-2.5 rounded-3xl px-5 py-16 text-center"
                style={{ background: "var(--lab-surface)", border: "1px solid var(--lab-border)" }}
              >
                <CoinsIcon className="h-6 w-6" style={{ color: "var(--lab-gold)" }} />
                <p className="max-w-[240px] text-[13px] text-text-dim">
                  No bets placed yet. Build a slip and tap Buy to place your first paper bet.
                </p>
              </div>
            )}

            {placedBets !== null && placedBets.length > 0 && (
              <div className="space-y-3">
                {placedBets.map((bet) => (
                  <PlacedBetCard
                    key={bet.id}
                    bet={bet}
                    livePrices={livePrices}
                    onRemove={(id) => setPlacedBets(removePlacedBet(id))}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <BetSlipBar
        legs={legs}
        livePrices={livePrices}
        onRemove={handleRemove}
        onClear={handleClear}
        onPlaced={() => setPlacedBets(loadPlacedBets())}
      />

      {openPick && <PickDetailSheet pick={openPick} onClose={() => setOpenPick(null)} />}
      {celebration && (
        <WinCelebration
          teams={celebration.teams}
          fallEmojis={celebration.fallEmojis}
          bgColors={celebration.bgColors}
          onClose={() => setCelebration(null)}
        />
      )}
    </div>
  );
}

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="press flex-1 rounded-full py-1.5 text-[12px] font-semibold"
      style={active ? { background: "var(--lab-gold)", color: "#1a0f05" } : { color: "var(--text-faint)" }}
    >
      {label}
      {typeof count === "number" && count > 0 && ` (${count})`}
    </button>
  );
}

// One accent color per risk step — cool/safe (green, cyan) through neutral (silver) to hot (red,
// with mega turned up louder than risky) — reusing the page's existing accent tokens rather than
// introducing new ones. Each button gets a tinted background in that color, the same "colored
// glass" treatment the bet slip's own pill uses, rather than a plain neutral box with a dot.
const RISK_ACCENT: Record<RiskMode, { rgb: string; color: string; bg: number }> = {
  calm: { rgb: "var(--lab-green-rgb)", color: "var(--lab-green)", bg: 0.16 },
  easy: { rgb: "var(--lab-cyan-rgb)", color: "var(--lab-cyan)", bg: 0.16 },
  normal: { rgb: "var(--lab-gold-rgb)", color: "var(--lab-gold)", bg: 0.16 },
  risky: { rgb: "var(--lab-red-rgb)", color: "var(--lab-red)", bg: 0.16 },
  mega: { rgb: "var(--lab-red-rgb)", color: "var(--lab-red)", bg: 0.26 },
};

function RiskButton({ mode, onClick }: { mode: (typeof RISK_MODES)[number]; onClick: () => void }) {
  const a = RISK_ACCENT[mode.id];
  return (
    <button
      onClick={onClick}
      className="press flex flex-1 items-center justify-center rounded-2xl py-2.5 text-[11px] font-semibold"
      style={{
        background: `rgba(${a.rgb}, ${a.bg})`,
        color: a.color,
        boxShadow: `inset 0 0 0 1px rgba(${a.rgb}, 0.3)`,
      }}
    >
      {mode.label}
    </button>
  );
}

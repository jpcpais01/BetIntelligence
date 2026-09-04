"use client";

import { useEffect, useMemo, useState } from "react";
import type { SavedPick, SavedMarketPick } from "@/lib/types";
import { loadPicks } from "@/lib/picks";
import { loadMarketPicks } from "@/lib/marketPicks";
import { loadSlip, saveSlip, legFromPick, legFromMarketPick, type SlipLeg, type Outcome } from "@/lib/betslip";
import { loadPlacedBets, type PlacedBet } from "@/lib/placedBets";
import { liveKey, fetchLivePrices, type LivePriceRequest } from "@/lib/livePrices";
import SlipPickRow from "@/components/SlipPickRow";
import MarketPickRow from "@/components/MarketPickRow";
import PlacedBetCard from "@/components/PlacedBetCard";
import BetSlipBar from "@/components/BetSlipBar";
import PickDetailSheet from "@/components/PickDetailSheet";
import MarketPickDetailSheet from "@/components/MarketPickDetailSheet";
import { useRequestLogos } from "@/components/ClubLogosProvider";
import { SearchIcon, TicketIcon, CoinsIcon } from "@/components/icons";

type Filter = "all" | "football";
type Tab = "build" | "bets";

type AnyPick =
  | { kind: "sports"; savedAt: string; pick: SavedPick }
  | { kind: "market"; savedAt: string; pick: SavedMarketPick };

export default function LabPage() {
  const [sportsPicks, setSportsPicks] = useState<SavedPick[] | null>(null);
  const [marketPicks, setMarketPicks] = useState<SavedMarketPick[] | null>(null);
  const [placedBets, setPlacedBets] = useState<PlacedBet[] | null>(null);
  const [legs, setLegs] = useState<SlipLeg[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tab, setTab] = useState<Tab>("build");
  const [openPick, setOpenPick] = useState<AnyPick | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const requestLogos = useRequestLogos();

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR */
    setSportsPicks(loadPicks());
    setMarketPicks(loadMarketPicks());
    setLegs(loadSlip());
    setPlacedBets(loadPlacedBets());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!sportsPicks || sportsPicks.length === 0) return;
    requestLogos(sportsPicks.flatMap((p) => [p.homeTeam, p.awayTeam]));
  }, [sportsPicks, requestLogos]);

  const picks = useMemo<AnyPick[] | null>(() => {
    if (sportsPicks === null || marketPicks === null) return null;
    const merged: AnyPick[] = [
      ...sportsPicks.map((pick): AnyPick => ({ kind: "sports", savedAt: pick.savedAt, pick })),
      ...marketPicks.map((pick): AnyPick => ({ kind: "market", savedAt: pick.savedAt, pick })),
    ];
    return merged.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  }, [sportsPicks, marketPicks]);

  // Every picked outcome's live current price, keyed the same way a SlipLeg identifies itself
  // (liveKey) — one fetch serves the browsing rows below, the slip bar, and My Bets alike, all
  // reading from this same map. Missing keys (an old pick with no tokenId, or a fetch that hasn't
  // landed yet) fall back to that pick's own stored snapshot at each call site.
  useEffect(() => {
    if (!picks || picks.length === 0) return;
    const requests: LivePriceRequest[] = [];
    for (const item of picks) {
      if (item.kind === "sports") {
        const p = item.pick;
        requests.push({ key: liveKey(p.id, p.homeTeam), tokenId: p.tokenIds?.home, fallback: p.market.home });
        requests.push({ key: liveKey(p.id, "Draw"), tokenId: p.tokenIds?.draw, fallback: p.market.draw });
        requests.push({ key: liveKey(p.id, p.awayTeam), tokenId: p.tokenIds?.away, fallback: p.market.away });
      } else {
        const p = item.pick;
        for (const o of p.market) {
          requests.push({ key: liveKey(p.id, o.label), tokenId: o.tokenId, fallback: o.price });
        }
      }
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
    const byKind = filter === "football" ? picks.filter((p) => p.kind === "sports") : picks;
    const q = query.trim().toLowerCase();
    if (!q) return byKind;
    return byKind.filter((item) =>
      item.kind === "sports"
        ? item.pick.homeTeam.toLowerCase().includes(q) ||
          item.pick.awayTeam.toLowerCase().includes(q) ||
          item.pick.leagueName.toLowerCase().includes(q)
        : item.pick.title.toLowerCase().includes(q) || item.pick.category.toLowerCase().includes(q)
    );
  }, [picks, query, filter]);

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

  const handlePickMarket = (pick: SavedMarketPick, outcomeLabel: string) => {
    const leg = legFromMarketPick(pick, outcomeLabel);
    if (leg) upsertLeg(pick.id, leg);
  };

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

          {tab === "build" && picks && picks.length > 0 && (
            <div className="flex flex-1 gap-1.5 rounded-full p-1" style={{ background: "var(--lab-surface-2)" }}>
              <FilterButton label="All" active={filter === "all"} onClick={() => setFilter("all")} />
              <FilterButton label="Football" active={filter === "football"} onClick={() => setFilter("football")} />
            </div>
          )}
        </div>
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
                  Analyze a match or a market and save it as a pick, then stack it into a slip here.
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
                {filteredPicks.map((item) =>
                  item.kind === "sports" ? (
                    <SlipPickRow
                      key={item.pick.id}
                      pick={item.pick}
                      livePrices={livePrices}
                      selectedOutcome={legByPickId.get(item.pick.id) ?? null}
                      onPick={(outcome) => handlePickSports(item.pick, outcome)}
                      onOpen={() => setOpenPick(item)}
                    />
                  ) : (
                    <MarketPickRow
                      key={item.pick.id}
                      pick={item.pick}
                      livePrices={livePrices}
                      selectedOutcomeLabel={legByPickId.get(item.pick.id) ?? null}
                      onPick={(outcomeLabel) => handlePickMarket(item.pick, outcomeLabel)}
                      onOpen={() => setOpenPick(item)}
                    />
                  )
                )}
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
                  <PlacedBetCard key={bet.id} bet={bet} livePrices={livePrices} />
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

      {openPick?.kind === "sports" && (
        <PickDetailSheet pick={openPick.pick} onClose={() => setOpenPick(null)} />
      )}
      {openPick?.kind === "market" && (
        <MarketPickDetailSheet pick={openPick.pick} onClose={() => setOpenPick(null)} />
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

function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="press flex-1 rounded-full py-1.5 text-[12px] font-medium"
      style={active ? { background: "rgba(var(--lab-gold-rgb), 0.16)", color: "var(--lab-gold)" } : { color: "var(--text-faint)" }}
    >
      {label}
    </button>
  );
}

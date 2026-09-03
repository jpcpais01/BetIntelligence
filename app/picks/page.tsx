"use client";

import { useEffect, useMemo, useState } from "react";
import type { SavedPick, SavedMarketPick } from "@/lib/types";
import { loadPicks, removePick } from "@/lib/picks";
import { loadMarketPicks, removeMarketPick } from "@/lib/marketPicks";
import PickCard from "@/components/PickCard";
import SavedMarketPickCard from "@/components/SavedMarketPickCard";
import PickDetailSheet from "@/components/PickDetailSheet";
import MarketPickDetailSheet from "@/components/MarketPickDetailSheet";
import { useRequestLogos } from "@/components/ClubLogosProvider";
import { BookmarkIcon } from "@/components/icons";

type AnyPick =
  | { kind: "sports"; savedAt: string; pick: SavedPick }
  | { kind: "market"; savedAt: string; pick: SavedMarketPick };

type Filter = "all" | "football";

export default function PicksPage() {
  const [sportsPicks, setSportsPicks] = useState<SavedPick[] | null>(null);
  const [marketPicks, setMarketPicks] = useState<SavedMarketPick[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [openPick, setOpenPick] = useState<AnyPick | null>(null);
  const requestLogos = useRequestLogos();

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage is unavailable during SSR/hydration */
    setSportsPicks(loadPicks());
    setMarketPicks(loadMarketPicks());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!sportsPicks || sportsPicks.length === 0) return;
    requestLogos(sportsPicks.flatMap((p) => [p.homeTeam, p.awayTeam]));
  }, [sportsPicks, requestLogos]);

  const handleRemoveSports = (id: string) => setSportsPicks(removePick(id));
  const handleRemoveMarket = (id: string) => setMarketPicks(removeMarketPick(id));

  // Every saved analysis, football and Discover alike, merged into one feed sorted by when it
  // was saved — Picks is meant to be a single place to see everything you've analyzed, not one
  // list per market type.
  const picks = useMemo<AnyPick[] | null>(() => {
    if (sportsPicks === null || marketPicks === null) return null;
    const merged: AnyPick[] = [
      ...sportsPicks.map((pick): AnyPick => ({ kind: "sports", savedAt: pick.savedAt, pick })),
      ...marketPicks.map((pick): AnyPick => ({ kind: "market", savedAt: pick.savedAt, pick })),
    ];
    return merged.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  }, [sportsPicks, marketPicks]);

  const filteredPicks = useMemo(
    () => (filter === "football" ? picks?.filter((p) => p.kind === "sports") ?? null : picks),
    [picks, filter]
  );

  const valueCount =
    (sportsPicks?.filter((p) => p.comparison.bestValue !== "none").length ?? 0) +
    (marketPicks?.filter((p) => p.comparison.bestValue !== null).length ?? 0);

  return (
    <div className="mx-auto max-w-md">
      <header className="safe-top sticky top-0 z-30 border-b border-border-soft bg-bg/85 px-4 pb-3 backdrop-blur-xl">
        <h1 className="font-display text-[17px] font-bold tracking-tight">Picks</h1>
        <p className="text-[11px] text-text-faint">Every saved analysis &middot; paper only, no real money</p>

        {picks && picks.length > 0 && (
          <div className="mt-3 flex gap-1.5 rounded-full bg-surface-2 p-1">
            <FilterButton label="All" active={filter === "all"} onClick={() => setFilter("all")} />
            <FilterButton label="Football" active={filter === "football"} onClick={() => setFilter("football")} />
          </div>
        )}
      </header>

      <div className="px-4 pt-4">
        {picks && picks.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border-soft bg-surface p-3.5">
              <p className="text-[11px] text-text-faint">Tracked</p>
              <p className="font-display text-2xl font-bold tabular-nums">{filteredPicks?.length ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-accent/8 p-3.5 ring-1 ring-inset ring-accent/20">
              <p className="text-[11px] text-accent/70">Value spots</p>
              <p className="font-display text-2xl font-bold tabular-nums text-accent">{valueCount}</p>
            </div>
          </div>
        )}

        {picks !== null && picks.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-border-soft bg-surface px-5 py-16 text-center">
            <BookmarkIcon className="h-6 w-6 text-text-faint" />
            <p className="max-w-[220px] text-[13px] text-text-dim">
              No saved picks yet. Analyze a match on Sports or a market on Discover and save it here.
            </p>
          </div>
        )}

        {picks !== null && picks.length > 0 && filteredPicks?.length === 0 && (
          <p className="py-10 text-center text-[13px] text-text-faint">No football picks saved yet.</p>
        )}

        {filteredPicks !== null && filteredPicks.length > 0 && (
          <div className="space-y-3">
            {filteredPicks.map((item) =>
              item.kind === "sports" ? (
                <PickCard
                  key={item.pick.id}
                  pick={item.pick}
                  onRemove={handleRemoveSports}
                  onOpen={(pick) => setOpenPick({ kind: "sports", savedAt: pick.savedAt, pick })}
                />
              ) : (
                <SavedMarketPickCard
                  key={item.pick.id}
                  pick={item.pick}
                  onRemove={handleRemoveMarket}
                  onOpen={(pick) => setOpenPick({ kind: "market", savedAt: pick.savedAt, pick })}
                />
              )
            )}
          </div>
        )}
      </div>

      {openPick?.kind === "sports" && (
        <PickDetailSheet pick={openPick.pick} onClose={() => setOpenPick(null)} />
      )}
      {openPick?.kind === "market" && (
        <MarketPickDetailSheet pick={openPick.pick} onClose={() => setOpenPick(null)} />
      )}
    </div>
  );
}

function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`press flex-1 rounded-full py-1.5 text-[12px] font-medium ${
        active ? "bg-accent/15 text-accent" : "text-text-faint"
      }`}
    >
      {label}
    </button>
  );
}

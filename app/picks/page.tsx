"use client";

import { useEffect, useState } from "react";
import type { SavedPick } from "@/lib/types";
import { loadPicks, removePick } from "@/lib/picks";
import PickCard from "@/components/PickCard";
import { useRequestLogos } from "@/components/ClubLogosProvider";
import { BookmarkIcon } from "@/components/icons";

export default function PicksPage() {
  const [picks, setPicks] = useState<SavedPick[] | null>(null);
  const requestLogos = useRequestLogos();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is unavailable during SSR/hydration
    setPicks(loadPicks());
  }, []);

  useEffect(() => {
    if (!picks || picks.length === 0) return;
    requestLogos(picks.flatMap((p) => [p.homeTeam, p.awayTeam]));
  }, [picks, requestLogos]);

  const handleRemove = (id: string) => {
    setPicks(removePick(id));
  };

  const valueCount = picks?.filter((p) => p.comparison.bestValue !== "none").length ?? 0;

  return (
    <div className="mx-auto max-w-md">
      <header className="safe-top sticky top-0 z-30 border-b border-border-soft bg-bg/85 px-4 pb-3 backdrop-blur-xl">
        <h1 className="font-display text-[17px] font-bold tracking-tight">Picks</h1>
        <p className="text-[11px] text-text-faint">Tracked calls &middot; paper only, no real money</p>
      </header>

      <div className="px-4 pt-4">
        {picks && picks.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border-soft bg-surface p-3.5">
              <p className="text-[11px] text-text-faint">Tracked</p>
              <p className="font-display text-2xl font-bold tabular-nums">{picks.length}</p>
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
              No saved picks yet. Analyze a match and save it here.
            </p>
          </div>
        )}

        {picks !== null && picks.length > 0 && (
          <div className="space-y-3">
            {picks.map((pick) => (
              <PickCard key={pick.id} pick={pick} onRemove={handleRemove} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { SavedPick } from "@/lib/types";
import { pruneFinishedPicks, removePick } from "@/lib/picks";
import PickCard from "@/components/PickCard";
import PickDetailSheet from "@/components/PickDetailSheet";
import { useRequestLogos } from "@/components/ClubLogosProvider";
import { BookmarkIcon } from "@/components/icons";

// Discover (and its saved market picks) is deactivated for now — this page is football-only,
// with no All/Football filter since there's nothing else to filter between. Any market picks
// already saved from before stay in storage untouched (lib/marketPicks.ts), just not read or
// shown here; nothing is deleted.
export default function PicksPage() {
  const [sportsPicks, setSportsPicks] = useState<SavedPick[] | null>(null);
  const [openPick, setOpenPick] = useState<SavedPick | null>(null);
  const requestLogos = useRequestLogos();

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is unavailable during SSR/hydration */
    setSportsPicks(pruneFinishedPicks());
  }, []);

  useEffect(() => {
    if (!sportsPicks || sportsPicks.length === 0) return;
    requestLogos(sportsPicks.flatMap((p) => [p.homeTeam, p.awayTeam]));
  }, [sportsPicks, requestLogos]);

  const handleRemove = (id: string) => setSportsPicks(removePick(id));

  const valueCount = sportsPicks?.filter((p) => p.comparison.bestValue !== "none").length ?? 0;

  return (
    <div className="mx-auto max-w-md">
      <div className="safe-top" />

      <div className="px-4 pt-4">
        {sportsPicks && sportsPicks.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border-soft bg-surface p-3.5">
              <p className="text-[11px] text-text-faint">Tracked</p>
              <p className="font-display text-2xl font-bold tabular-nums">{sportsPicks.length}</p>
            </div>
            <div className="rounded-2xl bg-accent/8 p-3.5 ring-1 ring-inset ring-accent/20">
              <p className="text-[11px] text-accent/70">Value spots</p>
              <p className="font-display text-2xl font-bold tabular-nums text-accent">{valueCount}</p>
            </div>
          </div>
        )}

        {sportsPicks !== null && sportsPicks.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-border-soft bg-surface px-5 py-16 text-center">
            <BookmarkIcon className="h-6 w-6 text-text-faint" />
            <p className="max-w-[220px] text-[13px] text-text-dim">
              No saved picks yet. Analyze a match on Sports and save it here.
            </p>
          </div>
        )}

        {sportsPicks !== null && sportsPicks.length > 0 && (
          <div className="space-y-3">
            {sportsPicks.map((pick) => (
              <PickCard key={pick.id} pick={pick} onRemove={handleRemove} onOpen={setOpenPick} />
            ))}
          </div>
        )}
      </div>

      {openPick && <PickDetailSheet pick={openPick} onClose={() => setOpenPick(null)} />}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { SavedPick } from "@/lib/types";
import { loadPicks, removePick } from "@/lib/picks";
import PickCard from "@/components/PickCard";
import { BookmarkIcon } from "@/components/icons";

export default function PicksPage() {
  const [picks, setPicks] = useState<SavedPick[] | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is unavailable during SSR/hydration
    setPicks(loadPicks());
  }, []);

  const handleRemove = (id: string) => {
    setPicks(removePick(id));
  };

  const valueCount = picks?.filter((p) => p.comparison.bestValue !== "none").length ?? 0;

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <header className="mb-5">
        <h1 className="font-display text-xl font-bold tracking-tight">My Picks</h1>
        <p className="text-xs text-text-faint">
          Tracked calls, paper only &mdash; no real money involved.
        </p>
      </header>

      {picks && picks.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border-soft bg-surface/70 p-4">
            <p className="text-[11px] text-text-faint">Picks tracked</p>
            <p className="font-display text-2xl font-bold">{picks.length}</p>
          </div>
          <div className="rounded-2xl border border-accent/30 bg-accent/10 p-4">
            <p className="text-[11px] text-accent/80">Value spots found</p>
            <p className="font-display text-2xl font-bold text-accent">{valueCount}</p>
          </div>
        </div>
      )}

      {picks === null && <div className="py-20" />}

      {picks !== null && picks.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-border-soft bg-surface/70 px-5 py-16 text-center">
          <BookmarkIcon className="h-7 w-7 text-text-faint" />
          <p className="max-w-[220px] text-sm text-text-dim">
            No saved picks yet. Run an AI Analysis on a game and save it here.
          </p>
        </div>
      )}

      {picks !== null && picks.length > 0 && (
        <div className="space-y-4">
          {picks.map((pick) => (
            <PickCard key={pick.id} pick={pick} onRemove={handleRemove} />
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import type { SavedPick } from "@/lib/types";
import { loadPicks } from "@/lib/picks";
import {
  loadSlip,
  saveSlip,
  legFromPick,
  combineSlip,
  legEdge,
  outcomeLabel,
  type SlipLeg,
  type Outcome,
} from "@/lib/betslip";
import { toPercent, toSignedPercent, toDecimalOdds } from "@/lib/format";
import SlipPickRow from "@/components/SlipPickRow";
import { SearchIcon, XCircleIcon, TicketIcon, ScaleIcon } from "@/components/icons";

type Mode = "single" | "multi";

export default function SlipPage() {
  const [picks, setPicks] = useState<SavedPick[] | null>(null);
  const [legs, setLegs] = useState<SlipLeg[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("single");

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR */
    setPicks(loadPicks());
    setLegs(loadSlip());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

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
    const map = new Map<string, Outcome>();
    for (const leg of legs) map.set(leg.pickId, leg.outcome);
    return map;
  }, [legs]);

  const handlePick = (pick: SavedPick, outcome: Outcome) => {
    setLegs((current) => {
      const existing = current.find((l) => l.pickId === pick.id);
      let next: SlipLeg[];
      if (existing && existing.outcome === outcome) {
        // Tapping the already-chosen outcome removes that leg.
        next = current.filter((l) => l.pickId !== pick.id);
      } else if (existing) {
        next = current.map((l) => (l.pickId === pick.id ? legFromPick(pick, outcome) : l));
      } else {
        next = [...current, legFromPick(pick, outcome)];
      }
      saveSlip(next);
      return next;
    });
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

  const combined = useMemo(() => combineSlip(legs), [legs]);

  return (
    <div className="mx-auto max-w-md">
      <header className="safe-top sticky top-0 z-30 border-b border-border-soft bg-bg/85 px-4 pb-3 backdrop-blur-xl">
        <h1 className="font-display text-[17px] font-bold tracking-tight">Bet Slip</h1>
        <p className="text-[11px] text-text-faint">Build from analyzed picks &middot; paper only</p>

        <div className="relative mt-3">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search analyzed games..."
            className="w-full rounded-full bg-surface py-2.5 pl-9 pr-3 text-[13px] text-text placeholder:text-text-faint ring-1 ring-inset ring-border-soft focus:outline-none focus:ring-accent/40"
          />
        </div>
      </header>

      <div className="px-4 pt-4">
        {legs.length > 0 && (
          <div className="mb-5 rounded-2xl border border-border-soft bg-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TicketIcon className="h-4 w-4 text-accent" />
                <p className="text-[13px] font-semibold text-text">
                  Your slip &middot; {legs.length} leg{legs.length === 1 ? "" : "s"}
                </p>
              </div>
              <button
                onClick={handleClear}
                className="press text-[11px] font-medium text-text-faint hover:text-accent-3"
              >
                Clear
              </button>
            </div>

            {legs.length > 1 && (
              <div className="mb-3 flex gap-1.5 rounded-full bg-surface-2 p-1">
                <ModeButton label="Single" active={mode === "single"} onClick={() => setMode("single")} />
                <ModeButton label="Multi" active={mode === "multi"} onClick={() => setMode("multi")} />
              </div>
            )}

            <div className="space-y-2">
              {legs.map((leg) => (
                <LegRow key={leg.pickId} leg={leg} onRemove={() => handleRemove(leg.pickId)} />
              ))}
            </div>

            {mode === "multi" && legs.length > 1 && (
              <div className="mt-3 space-y-2.5 rounded-xl bg-surface-2 p-3.5">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-text-faint">
                  <ScaleIcon className="h-3 w-3" />
                  Combined ({legs.length}-leg parlay)
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  <CombinedStat
                    label="Market"
                    prob={combined.marketProb}
                    odds={toDecimalOdds(combined.marketProb)}
                  />
                  <CombinedStat
                    label="AI"
                    prob={combined.aiProb}
                    odds={toDecimalOdds(combined.aiProb)}
                    accent
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg bg-bg-elevated px-3 py-2">
                  <span className="text-[11px] text-text-faint">Combined edge</span>
                  <span
                    className={`font-display text-[13px] font-semibold tabular-nums ${
                      combined.edge > 0.005
                        ? "text-accent"
                        : combined.edge < -0.005
                          ? "text-accent-3"
                          : "text-text-faint"
                    }`}
                  >
                    {toSignedPercent(combined.edge)}
                  </span>
                </div>
                <p className="text-[10px] leading-relaxed text-text-faint">
                  Multiplying each leg&apos;s independent AI probability together vs. multiplying each
                  leg&apos;s market probability together &mdash; the gap is how much more (or less)
                  likely the AI thinks this exact parlay is than the market prices it.
                </p>
              </div>
            )}
          </div>
        )}

        {picks === null && <div className="py-16" />}

        {picks !== null && picks.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-border-soft bg-surface px-5 py-16 text-center">
            <TicketIcon className="h-6 w-6 text-text-faint" />
            <p className="max-w-[240px] text-[13px] text-text-dim">
              Analyze a match and save it as a pick, then build a slip from it here.
            </p>
          </div>
        )}

        {picks !== null && picks.length > 0 && filteredPicks.length === 0 && (
          <p className="py-10 text-center text-[13px] text-text-faint">No analyzed games match &quot;{query}&quot;.</p>
        )}

        {filteredPicks.length > 0 && (
          <div className="space-y-3 pb-4">
            {filteredPicks.map((pick) => (
              <SlipPickRow
                key={pick.id}
                pick={pick}
                selectedOutcome={legByPickId.get(pick.id) ?? null}
                onPick={(outcome) => handlePick(pick, outcome)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

function LegRow({ leg, onRemove }: { leg: SlipLeg; onRemove: () => void }) {
  const edge = legEdge(leg);
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-text">
          {outcomeLabel(leg)}
          <span className="ml-1.5 font-normal text-text-faint">
            &middot; {leg.homeTeam} v {leg.awayTeam}
          </span>
        </p>
        <p className="text-[10px] tabular-nums text-text-faint">
          AI {toPercent(leg.aiProb)} &middot; mkt {toPercent(leg.marketProb)} &middot; edge{" "}
          <span
            className={edge > 0.005 ? "text-accent" : edge < -0.005 ? "text-accent-3" : "text-text-faint"}
          >
            {toSignedPercent(edge)}
          </span>
        </p>
      </div>
      <button
        onClick={onRemove}
        aria-label="Remove leg"
        className="press shrink-0 text-text-faint hover:text-accent-3"
      >
        <XCircleIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function CombinedStat({
  label,
  prob,
  odds,
  accent,
}: {
  label: string;
  prob: number;
  odds: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg bg-bg-elevated px-3 py-2 text-center">
      <p className="text-[10px] text-text-faint">{label}</p>
      <p
        className={`font-display text-[15px] font-semibold tabular-nums ${accent ? "text-accent" : "text-text"}`}
      >
        {toPercent(prob)}
      </p>
      <p className="text-[10px] tabular-nums text-text-faint">{odds}x</p>
    </div>
  );
}

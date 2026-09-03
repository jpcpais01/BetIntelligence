"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Market } from "@/lib/types";
import MarketCard from "@/components/MarketCard";
import MarketCardSkeleton from "@/components/MarketCardSkeleton";
import MarketAnalysisSheet from "@/components/MarketAnalysisSheet";
import ModelPicker from "@/components/ModelPicker";
import { AlertIcon, RefreshIcon, CompassIcon, FlameIcon, BookmarkIcon } from "@/components/icons";
import { formatRelativeTime } from "@/lib/format";
import { loadCachedMarkets, saveCachedMarkets, isStale, REFRESH_INTERVAL_MS } from "@/lib/marketsCache";
import { loadLastMarketAnalyses, type LastMarketAnalysisEntry } from "@/lib/lastMarketAnalysis";

export default function DiscoverPage() {
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [category, setCategory] = useState("All");
  const [analyzeMarket, setAnalyzeMarket] = useState<Market | null>(null);
  const [lastAnalysisMap, setLastAnalysisMap] = useState<Record<string, LastMarketAnalysisEntry>>({});

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/markets", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load markets.");
      const now = new Date().toISOString();
      setMarkets(data.markets);
      setFetchedAt(now);
      setError(null);
      saveCachedMarkets(data.markets, now);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load markets.");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const cached = loadCachedMarkets();
    if (cached) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR */
      setMarkets(cached.markets);
      setFetchedAt(cached.fetchedAt);
    }
    setLastAnalysisMap(loadLastMarketAnalyses());
    if (!cached || isStale(cached.fetchedAt)) void refresh();
  }, [refresh]);

  // Re-read whenever the analysis sheet closes — analyses are cached automatically as soon as
  // they finish (lib/lastMarketAnalysis.ts), whether or not the user tapped Save, so this is how
  // a card picks up "what the AI last said" right after you close the sheet.
  const refreshLastAnalysis = useCallback(() => setLastAnalysisMap(loadLastMarketAnalyses()), []);

  useEffect(() => {
    const id = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && isStale(fetchedAt)) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [fetchedAt, refresh]);

  const categories = useMemo(() => {
    if (!markets) return [];
    const counts = new Map<string, number>();
    for (const m of markets) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 8);
  }, [markets]);

  const filtered = useMemo(() => {
    if (!markets) return [];
    return category === "All" ? markets : markets.filter((m) => m.category === category);
  }, [markets, category]);

  const hotIds = useMemo(() => {
    if (!markets) return new Set<string>();
    return new Set(
      [...markets]
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 6)
        .map((m) => m.id)
    );
  }, [markets]);

  const tickerMarkets = useMemo(() => (markets ?? []).slice(0, 10), [markets]);

  const showFullError = error !== null && markets === null;

  return (
    <div className="discover crt-scanlines mx-auto max-w-md" style={{ background: "var(--d-surface)" }}>
      <header
        className="discover-grid safe-top sticky top-0 z-30 overflow-hidden px-4 pb-4"
        style={{
          background:
            "radial-gradient(120% 100% at 0% 0%, rgba(var(--d-accent-rgb),0.28), transparent 60%), radial-gradient(120% 100% at 100% 0%, rgba(var(--d-violet-rgb), 0.22), transparent 55%), var(--d-surface)",
          borderBottom: "1px solid var(--d-border)",
        }}
      >
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 font-display text-[19px] font-bold tracking-tight text-text">
              <CompassIcon className="h-5 w-5" style={{ color: "var(--d-accent-2)" }} />
              Discover
            </h1>
            <p className="text-[11px] text-text-faint">
              {isRefreshing ? "Scanning every market..." : `Updated ${formatRelativeTime(fetchedAt)}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ModelPicker variant="discover" />
            <Link
              href="/picks"
              aria-label="View saved picks"
              className="press rounded-sm p-2.5 text-text-dim ring-1 ring-inset"
              style={{ background: "var(--d-surface-2)", borderColor: "var(--d-border)" }}
            >
              <BookmarkIcon className="h-4 w-4" />
            </Link>
            <button
              onClick={() => void refresh()}
              disabled={isRefreshing}
              aria-label="Refresh markets"
              className="press rounded-sm p-2.5 text-text-dim ring-1 ring-inset disabled:opacity-50"
              style={{ background: "var(--d-surface-2)", borderColor: "var(--d-border)" }}
            >
              <RefreshIcon className={`h-4 w-4 ${isRefreshing ? "spin" : ""}`} />
            </button>
          </div>
        </div>

        {tickerMarkets.length > 0 && (
          <div className="-mx-4 overflow-hidden px-4">
            <div className="flex w-max gap-2">
              <div className="marquee-track flex w-max shrink-0 gap-2">
                <TickerRow markets={tickerMarkets} />
              </div>
              <div className="marquee-track flex w-max shrink-0 gap-2" aria-hidden>
                <TickerRow markets={tickerMarkets} />
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="px-4 pt-4">
        {categories.length > 0 && (
          <div className="mb-4 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <CategoryChip label="All" emoji="✨" active={category === "All"} onClick={() => setCategory("All")} />
            {categories.map((c) => {
              const emoji = markets?.find((m) => m.category === c)?.categoryEmoji ?? "🔮";
              return (
                <CategoryChip
                  key={c}
                  label={c}
                  emoji={emoji}
                  active={category === c}
                  onClick={() => setCategory(c)}
                />
              );
            })}
          </div>
        )}

        {error && markets !== null && (
          <div
            className="mb-3 flex items-center gap-2 rounded-sm px-3 py-2 ring-1 ring-inset"
            style={{ background: "rgba(var(--d-accent-2-rgb), 0.08)", borderColor: "var(--d-accent-2)" }}
          >
            <AlertIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--d-accent-2)" }} />
            <p className="text-[11px] text-text-dim">
              Couldn&apos;t refresh &mdash; showing markets from {formatRelativeTime(fetchedAt)}.
            </p>
          </div>
        )}

        {showFullError && (
          <div
            className="flex flex-col items-center gap-3 rounded-md border px-5 py-12 text-center"
            style={{ borderColor: "var(--d-border)" }}
          >
            <AlertIcon className="h-6 w-6" style={{ color: "var(--d-accent-2)" }} />
            <p className="selectable text-[13px] text-text-dim">{error}</p>
            <button
              onClick={() => void refresh()}
              className="press mt-1 rounded-sm px-4 py-2 text-xs font-semibold"
              style={{ background: "rgba(var(--d-accent-2-rgb), 0.12)", color: "var(--d-accent-2)" }}
            >
              Try again
            </button>
          </div>
        )}

        {!showFullError && markets === null && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <MarketCardSkeleton key={i} />
            ))}
          </div>
        )}

        {!showFullError && markets !== null && filtered.length === 0 && (
          <div
            className="flex flex-col items-center gap-2.5 rounded-md border px-5 py-14 text-center"
            style={{ borderColor: "var(--d-border)" }}
          >
            <CompassIcon className="h-6 w-6 text-text-faint" />
            <p className="max-w-[240px] text-[13px] text-text-dim">No markets in this category right now.</p>
          </div>
        )}

        {!showFullError && filtered.length > 0 && (
          <div className="space-y-3 pb-4">
            {filtered.map((market, i) => (
              <MarketCard
                key={market.id}
                market={market}
                hot={hotIds.has(market.id)}
                onAnalyze={setAnalyzeMarket}
                style={{ animationDelay: `${Math.min(i, 6) * 35}ms` }}
                lastAnalysis={lastAnalysisMap[market.id] ?? null}
              />
            ))}
          </div>
        )}
      </div>

      {analyzeMarket && (
        <MarketAnalysisSheet
          market={analyzeMarket}
          onClose={() => {
            setAnalyzeMarket(null);
            refreshLastAnalysis();
          }}
        />
      )}
    </div>
  );
}

function TickerRow({ markets }: { markets: Market[] }) {
  return (
    <>
      {markets.map((m) => (
        <div
          key={m.id}
          className="flex shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-medium ring-1 ring-inset"
          style={{ background: "var(--d-surface-2)", borderColor: "var(--d-border)", color: "var(--text-dim)" }}
        >
          <FlameIcon className="h-3 w-3" style={{ color: "var(--d-accent-2)" }} />
          <span className="max-w-[160px] truncate">{m.title}</span>
          <span className="font-display font-bold tabular-nums" style={{ color: "var(--d-accent-2)" }}>
            {Math.round(m.outcomes[0].price * 100)}%
          </span>
        </div>
      ))}
    </>
  );
}

function CategoryChip({
  label,
  emoji,
  active,
  onClick,
}: {
  label: string;
  emoji: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="press flex shrink-0 items-center gap-1.5 rounded-sm px-3.5 py-2 text-[12px] font-semibold ring-1 ring-inset"
      style={
        active
          ? { background: "linear-gradient(135deg, var(--d-accent), var(--d-violet))", color: "var(--bg)", borderColor: "transparent" }
          : { background: "var(--d-surface-2)", color: "var(--text-dim)", borderColor: "var(--d-border)" }
      }
    >
      <span>{emoji}</span>
      {label}
    </button>
  );
}

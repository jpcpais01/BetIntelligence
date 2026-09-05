export interface HistoryPoint {
  t: string; // ISO timestamp
  p: number; // price / implied probability, 0-1
}

export interface HistorySeries {
  label: string;
  color: string;
  points: HistoryPoint[];
}

export interface HistoryOutcomeQuery {
  label: string;
  tokenId: string | null;
  current: number;
  color: string;
}

// Talks to our own /api/odds-history proxy (never the CLOB API directly from the browser) so the
// real endpoint, mock-mode branching, and any future caching stay server-side in one place.
// `window` selects how much history and at what resolution — see components/OddsHistoryChart.tsx
// and lib/oddsHistoryServer.ts's WINDOW_CONFIG; omitted, it's the original 7-day view.
export async function fetchOddsHistory(
  outcomes: HistoryOutcomeQuery[],
  window?: "7d" | "1d" | "3h" | "live"
): Promise<HistorySeries[]> {
  const params = new URLSearchParams();
  if (window) params.set("window", window);
  for (const o of outcomes) {
    params.append("label", o.label);
    params.append("token", o.tokenId ?? "");
    params.append("current", String(o.current));
  }

  try {
    const res = await fetch(`/api/odds-history?${params.toString()}`);
    if (!res.ok) return outcomes.map((o) => ({ label: o.label, color: o.color, points: [] }));
    const data = (await res.json()) as { series?: { label: string; points: HistoryPoint[] }[] };
    const byLabel = new Map((data.series ?? []).map((s) => [s.label, s.points]));
    return outcomes.map((o) => ({ label: o.label, color: o.color, points: byLabel.get(o.label) ?? [] }));
  } catch {
    return outcomes.map((o) => ({ label: o.label, color: o.color, points: [] }));
  }
}

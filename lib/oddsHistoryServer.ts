import type { HistoryPoint } from "./oddsHistory";

const CLOB_BASE = "https://clob.polymarket.com";

// The odds-history chart's own window buttons (components/OddsHistoryChart.tsx) — each fetches
// its OWN interval/fidelity from CLOB rather than just re-slicing the 7-day series, so a shorter
// window actually shows finer-grained movement instead of the same coarse 3-hour buckets zoomed
// in. CLOB's interval enum doesn't have an exact "3h" option, so that one asks for its shortest
// useful interval (6h) at fine fidelity and the chart trims the extra 3h off client-side — see
// the WINDOWS table there. `1w`/`fidelity=180` (7d) is the one combination this app has actually
// confirmed live against the real API; `1d` and `6h` are CLOB's documented shorter intervals but
// haven't been confirmed the same way (this sandbox can't reach clob.polymarket.com to verify) —
// if either turns out wrong, the existing "not enough trading history" fallback degrades to that
// rather than crashing, since a bad interval value just yields an empty/error response same as a
// thin market already does.
//
// `live` is the odd one out: it has no fixed span of its own (a match could be 2 minutes or 2
// hours into play), so it reuses the exact same over-fetch-and-trim trick as `3h` — request CLOB's
// 6h interval, just at its finest fidelity (1-minute buckets), and let the chart trim to "since
// this match's own kickoff" client-side using that game's real start time, not a constant.
export type HistoryWindow = "7d" | "1d" | "3h" | "live";

const WINDOW_CONFIG: Record<HistoryWindow, { interval: string; fidelity: number }> = {
  "7d": { interval: "1w", fidelity: 180 },
  "1d": { interval: "1d", fidelity: 30 },
  "3h": { interval: "6h", fidelity: 5 },
  live: { interval: "6h", fidelity: 1 },
};

export function isHistoryWindow(value: unknown): value is HistoryWindow {
  return value === "7d" || value === "1d" || value === "3h" || value === "live";
}

interface ClobHistoryPoint {
  t?: number;
  p?: number;
}

interface ClobHistoryResponse {
  history?: ClobHistoryPoint[];
}

// Fetch accepts an injectable implementation so this is testable without real network — the
// same pattern lib/openrouter.ts uses for its own selftest. A market with no trading history yet
// (brand new, or thinly traded) legitimately 404s or returns an empty array; that's not an error
// worth surfacing, it just means "nothing to chart yet".
export async function fetchOutcomeHistory(
  tokenId: string,
  fetchImpl: typeof fetch = fetch,
  window: HistoryWindow = "7d"
): Promise<HistoryPoint[]> {
  const { interval, fidelity } = WINDOW_CONFIG[window];
  try {
    const res = await fetchImpl(
      `${CLOB_BASE}/prices-history?market=${encodeURIComponent(tokenId)}&interval=${interval}&fidelity=${fidelity}`,
      { headers: { accept: "application/json" } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as ClobHistoryResponse;
    if (!Array.isArray(data.history)) return [];
    return data.history
      .filter((pt): pt is { t: number; p: number } => typeof pt.t === "number" && typeof pt.p === "number")
      .map((pt) => ({ t: new Date(pt.t * 1000).toISOString(), p: pt.p }));
  } catch {
    return [];
  }
}

export async function fetchHistorySeries(
  outcomes: { label: string; tokenId: string | null }[],
  fetchImpl: typeof fetch = fetch,
  window: HistoryWindow = "7d"
): Promise<{ label: string; points: HistoryPoint[] }[]> {
  return Promise.all(
    outcomes.map(async (o) => ({
      label: o.label,
      points: o.tokenId ? await fetchOutcomeHistory(o.tokenId, fetchImpl, window) : [],
    }))
  );
}

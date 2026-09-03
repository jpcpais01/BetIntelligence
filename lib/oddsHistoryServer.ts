import type { HistoryPoint } from "./oddsHistory";

const CLOB_BASE = "https://clob.polymarket.com";

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
  fetchImpl: typeof fetch = fetch
): Promise<HistoryPoint[]> {
  try {
    const res = await fetchImpl(
      `${CLOB_BASE}/prices-history?market=${encodeURIComponent(tokenId)}&interval=1w&fidelity=180`,
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
  fetchImpl: typeof fetch = fetch
): Promise<{ label: string; points: HistoryPoint[] }[]> {
  return Promise.all(
    outcomes.map(async (o) => ({
      label: o.label,
      points: o.tokenId ? await fetchOutcomeHistory(o.tokenId, fetchImpl) : [],
    }))
  );
}

import type { HistoryPoint } from "./oddsHistory";

// Live current market prices for outcomes shown in Lab (and, via the same mechanism, the Home
// portfolio's mark-to-market). Reuses the /api/odds-history route built for the odds-history
// chart — its response is just a price series per requested key, and the LATEST point in that
// series is "the current price", so there's no need for a second API route.
//
// Every consumer shares one key scheme so a single fetched map serves both "browsing a pick"
// (SlipPickRow/MarketPickRow) and "a leg already on the slip or in a placed bet"
// (BetSlipBar/PlacedBetCard): `${pickId}:${outcomeLabel}` — exactly the pickId + outcomeLabel a
// SlipLeg already carries, so a leg's key is derivable without knowing anything else about it.
export function liveKey(pickId: string, outcomeLabel: string): string {
  return `${pickId}:${outcomeLabel}`;
}

export interface LivePriceRequest {
  key: string;
  tokenId: string | null | undefined;
  fallback: number;
}

function buildParams(requests: LivePriceRequest[]): URLSearchParams | null {
  const withToken = requests.filter((r) => r.tokenId);
  if (withToken.length === 0) return null;
  const params = new URLSearchParams();
  for (const r of withToken) {
    params.append("label", r.key);
    params.append("token", r.tokenId ?? "");
    params.append("current", String(r.fallback));
  }
  return params;
}

export async function fetchLivePrices(requests: LivePriceRequest[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const r of requests) result[r.key] = r.fallback;

  const params = buildParams(requests);
  if (!params) return result;

  try {
    const res = await fetch(`/api/odds-history?${params.toString()}`);
    if (!res.ok) return result;
    const data = (await res.json()) as { series?: { label: string; points: HistoryPoint[] }[] };
    for (const s of data.series ?? []) {
      const last = s.points[s.points.length - 1];
      if (last) result[s.label] = last.p;
    }
  } catch {
    // Fallback values are already seeded above.
  }
  return result;
}

// Same request shape as fetchLivePrices, but keeps the whole series instead of collapsing it to
// the latest point — Home's portfolio graph needs each leg's full price history to reconstruct
// value over time, not just "now".
export async function fetchPriceSeries(requests: LivePriceRequest[]): Promise<Record<string, HistoryPoint[]>> {
  const result: Record<string, HistoryPoint[]> = {};
  const params = buildParams(requests);
  if (!params) return result;

  try {
    const res = await fetch(`/api/odds-history?${params.toString()}`);
    if (!res.ok) return result;
    const data = (await res.json()) as { series?: { label: string; points: HistoryPoint[] }[] };
    for (const s of data.series ?? []) result[s.label] = s.points;
  } catch {
    // An empty map is a valid, honest "couldn't reprice anything right now".
  }
  return result;
}

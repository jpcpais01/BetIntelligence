const STORAGE_KEY = "betintelligence.logos.v1";
// Crests essentially never change, so this cache can live far longer than the odds cache.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedLogos {
  logos: Record<string, string>;
  fetchedAt: string;
}

export function loadCachedLogos(): CachedLogos | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.logos !== "object" || typeof parsed.fetchedAt !== "string") {
      return null;
    }
    return parsed as CachedLogos;
  } catch {
    return null;
  }
}

export function saveCachedLogos(logos: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ logos, fetchedAt: new Date().toISOString() })
    );
  } catch {
    // Best effort only.
  }
}

export function isLogoCacheStale(fetchedAt: string | null): boolean {
  if (!fetchedAt) return true;
  const t = new Date(fetchedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= TTL_MS;
}

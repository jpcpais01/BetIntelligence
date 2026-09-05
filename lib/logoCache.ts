// v3: the underlying lookup (lib/clubLogos.ts) got real name-verified matching plus alias/accent
// retry queries, both of which resolve some clubs (and correct some wrong crests) that the old
// logic couldn't — bumping the key means every already-"attempted" name gets a fresh try under
// the new logic instead of staying stuck on a stored miss (or a stored WRONG crest) forever.
const STORAGE_KEY = "betintelligence.logos.v3";

interface CachedLogos {
  logos: Record<string, string>;
  // Names we've already asked TheSportsDB about, whether or not a crest came back — crests
  // essentially never change and a "not found" result won't change either, so this is never
  // treated as stale and just grows over time instead of expiring.
  attempted: string[];
}

export function loadCachedLogos(): CachedLogos | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.logos !== "object" || !Array.isArray(parsed.attempted)) {
      return null;
    }
    return parsed as CachedLogos;
  } catch {
    return null;
  }
}

export function saveCachedLogos(logos: Record<string, string>, attempted: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ logos, attempted }));
  } catch {
    // Best effort only.
  }
}

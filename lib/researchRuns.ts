// How many times to independently run the "research this from scratch" step before comparing
// against the market. Running it more than once costs more (each run is its own full web-search
// request) but surfaces how consistent the model's read actually is — one run alone can't tell
// you whether an estimate is a stable read or a coin flip that happened to land somewhere.
export const MIN_RESEARCH_RUNS = 1;
export const MAX_RESEARCH_RUNS = 5;
export const DEFAULT_RESEARCH_RUNS = 1;

const STORAGE_KEY = "betintelligence.researchRuns.v1";

export function clampResearchRuns(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RESEARCH_RUNS;
  return Math.min(MAX_RESEARCH_RUNS, Math.max(MIN_RESEARCH_RUNS, Math.round(value)));
}

export function loadResearchRuns(): number {
  if (typeof window === "undefined") return DEFAULT_RESEARCH_RUNS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    return clampResearchRuns(parsed);
  } catch {
    return DEFAULT_RESEARCH_RUNS;
  }
}

export function saveResearchRuns(value: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clampResearchRuns(value)));
  } catch {
    // localStorage can be unavailable (private mode, quota) — the choice just won't persist.
  }
}

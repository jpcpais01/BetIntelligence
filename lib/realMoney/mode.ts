export type BetMode = "paper" | "real";

const STORAGE_KEY = "betintelligence.betMode.v1";

// Just remembers which tab was last selected, purely a UI convenience — it never grants access to
// anything by itself. The wallet (lib/realMoney/wallet.ts) always starts locked on a fresh load
// regardless of what this returns, so a reload with "real" remembered still requires the passphrase
// again before a single order can be placed.
export function loadBetMode(): BetMode {
  if (typeof window === "undefined") return "paper";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "real" ? "real" : "paper";
  } catch {
    return "paper";
  }
}

export function saveBetMode(mode: BetMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Best effort only.
  }
}

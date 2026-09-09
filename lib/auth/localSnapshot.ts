import { MIGRATABLE_KEYS, type MigratableKey } from "./migratableKeys";

// Reads every known localStorage key straight, raw JSON — no need to import each individual
// lib/*.ts module's own load function (lib/picks.ts's loadPicks, etc.) just to re-serialize what's
// already sitting there as a JSON string. A key that's missing, empty, or fails to parse (a
// corrupted entry, private-mode weirdness) is simply omitted from the snapshot rather than
// aborting the whole import over one bad key — this is a best-effort "bring what's here", not an
// all-or-nothing transaction.
export function collectLocalSnapshot(): Partial<Record<MigratableKey, unknown>> {
  if (typeof window === "undefined") return {};

  const snapshot: Partial<Record<MigratableKey, unknown>> = {};
  for (const [key, storageKey] of Object.entries(MIGRATABLE_KEYS) as [MigratableKey, string][]) {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) continue;
      snapshot[key] = JSON.parse(raw);
    } catch {
      // Skip this one key; every other one still gets collected.
    }
  }
  return snapshot;
}

// Whether there's anything at all worth offering to import — used to decide whether the signup
// flow even shows the "import your existing data?" step, rather than showing it (with nothing
// behind it) to someone signing up on a brand-new browser profile.
export function hasLocalDataToMigrate(): boolean {
  return Object.keys(collectLocalSnapshot()).length > 0;
}

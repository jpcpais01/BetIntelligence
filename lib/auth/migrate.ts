import { getDb } from "../firebaseAdmin";
import { normalizeUsername } from "./users";
import { MIGRATABLE_KEYS, type MigratableKey } from "./migratableKeys";

// Writes a client-collected localStorage snapshot (lib/auth/localSnapshot.ts) into that user's own
// Firestore document, one small document per data type (users/{id}/data/{key}) rather than one
// giant blob — both because a single document has a 1MB cap Firestore enforces (lastAnalysis alone
// can hold up to 150 entries with full verdict/pros/cons text, which could plausibly approach
// that) and because this is the same per-type shape a future ongoing-sync layer will want to write
// to anyway, so this schema doesn't need to change out from under it later.
//
// Only ever called once, right after a fresh signup, with whatever the browser already had —
// never overwrites anything for an EXISTING account (there's nothing to overwrite: a brand-new
// user document has no `data` subcollection yet), so this can't clobber real synced data.
export async function importLocalData(username: string, snapshot: Partial<Record<MigratableKey, unknown>>): Promise<{ importedKeys: MigratableKey[] }> {
  const id = normalizeUsername(username);
  const db = getDb();
  const batch = db.batch();
  const now = new Date().toISOString();
  const importedKeys: MigratableKey[] = [];

  for (const key of Object.keys(snapshot) as MigratableKey[]) {
    if (!(key in MIGRATABLE_KEYS)) continue; // ignore anything not on the known allowlist
    const value = snapshot[key];
    if (value === undefined) continue;
    const ref = db.collection("users").doc(id).collection("data").doc(key);
    batch.set(ref, { value, migratedAt: now });
    importedKeys.push(key);
  }

  if (importedKeys.length > 0) await batch.commit();
  return { importedKeys };
}

import type { Firestore, DocumentReference, DocumentData } from "firebase-admin/firestore";
import { getDb } from "../firebaseAdmin";
import { normalizeUsername } from "./users";
import { MIGRATABLE_KEYS, MAP_SHAPED_KEYS, ARRAY_SHAPED_KEYS, type MigratableKey } from "./migratableKeys";

// Firestore's own batch cap is 500 writes; this stays comfortably under it so a single oversized
// history never needs special-casing.
const BATCH_CHUNK_SIZE = 400;

async function commitInChunks(db: Firestore, writes: { ref: DocumentReference; data: DocumentData }[]): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_CHUNK_SIZE) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + BATCH_CHUNK_SIZE)) batch.set(w.ref, w.data);
    await batch.commit();
  }
}

function hasStringId(item: unknown): item is { id: string } {
  return !!item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" && (item as { id: string }).id.length > 0;
}

// Writes one data type's worth of a migration snapshot. Map-shaped and array-shaped keys (see
// migratableKeys.ts) are split one-document-per-record rather than one document for the whole
// key — the fix for a real Firestore 1MiB-per-document cap a sizeable real history could hit.
// Anything else is small enough to stay a single document, same as before.
async function importOneKey(db: Firestore, userId: string, key: MigratableKey, value: unknown, now: string): Promise<void> {
  if (MAP_SHAPED_KEYS.includes(key) && value && typeof value === "object" && !Array.isArray(value)) {
    const writes = Object.entries(value as Record<string, unknown>).map(([subId, subValue]) => ({
      ref: db.collection("users").doc(userId).collection(key).doc(subId),
      data: { value: subValue, migratedAt: now },
    }));
    await commitInChunks(db, writes);
    return;
  }

  if (ARRAY_SHAPED_KEYS.includes(key) && Array.isArray(value)) {
    const writes = value.filter(hasStringId).map((item) => ({
      ref: db.collection("users").doc(userId).collection(key).doc(item.id),
      data: { value: item, migratedAt: now },
    }));
    await commitInChunks(db, writes);
    return;
  }

  // A single-blob key, or a keyed type that arrived in an unexpected shape — stored whole rather
  // than silently dropped.
  await db.collection("users").doc(userId).collection("data").doc(key).set({ value, migratedAt: now });
}

export interface ImportOutcome {
  importedKeys: MigratableKey[];
  failedKeys: MigratableKey[];
}

// Writes a client-collected localStorage snapshot (lib/auth/localSnapshot.ts) into that user's own
// Firestore data — best-effort PER KEY: one key failing (an oversized single value, a transient
// Firestore error) never blocks the others, and this whole function is itself best-effort from the
// signup route's point of view (see app/api/auth/signup/route.ts) — the account is always created
// and the session always issued regardless of how the import goes, since by the time this runs the
// account already exists and a failed import must never look like a failed signup.
//
// Only ever called once, right after a fresh signup, with whatever the browser already had — never
// overwrites anything for an EXISTING account importing again, since re-signing up isn't possible;
// a per-record document layout also means importing twice would just harmlessly overwrite the same
// records by the same ids, not duplicate them, if this were ever called again.
export async function importLocalData(username: string, snapshot: Partial<Record<MigratableKey, unknown>>): Promise<ImportOutcome> {
  const id = normalizeUsername(username);
  const db = getDb();
  const now = new Date().toISOString();
  const importedKeys: MigratableKey[] = [];
  const failedKeys: MigratableKey[] = [];

  for (const key of Object.keys(snapshot) as MigratableKey[]) {
    if (!(key in MIGRATABLE_KEYS)) continue;
    const value = snapshot[key];
    if (value === undefined) continue;

    try {
      await importOneKey(db, id, key, value, now);
      importedKeys.push(key);
    } catch (err) {
      console.error(`Local-data import failed for key "${key}"`, err);
      failedKeys.push(key);
    }
  }

  return { importedKeys, failedKeys };
}

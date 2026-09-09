import { NextResponse } from "next/server";
import { getSessionUsername } from "@/lib/auth/session";
import { getDb } from "@/lib/firebaseAdmin";
import { normalizeUsername } from "@/lib/auth/users";

export const maxDuration = 30;

// Read-only: returns every lastAnalysis record this logged-in user has ever had migrated into
// Firestore (lib/auth/migrate.ts writes one document per game under users/{id}/lastAnalysis/
// {gameId}), keyed the same way the local cache is (lib/lastAnalysis.ts) so a caller can merge the
// two directly. Nothing here writes anything — new analyses still save to localStorage only (see
// components/AnalysisSheet.tsx/BatchAnalysisSheet.tsx), unchanged; this endpoint exists purely so
// the Overview page can also see whatever was already imported (at signup, or by a future sync
// pass) without requiring every device to have re-run every analysis locally.
export async function GET() {
  const username = await getSessionUsername();
  if (!username) return NextResponse.json({ entries: {} });

  try {
    const id = normalizeUsername(username);
    const snap = await getDb().collection("users").doc(id).collection("lastAnalysis").get();
    const entries: Record<string, unknown> = {};
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data && "value" in data) entries[doc.id] = data.value;
    }
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("GET /api/account/last-analysis failed", err);
    // Best-effort, same as every other enrichment read in this app — a failure here just means
    // Overview falls back to whatever's already local, never a broken page.
    return NextResponse.json({ entries: {} });
  }
}

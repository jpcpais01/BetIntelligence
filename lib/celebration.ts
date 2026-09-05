import type { PlacedBet } from "./placedBets";
import { wonTeamName } from "./settlement";

export interface Celebration {
  teamName: string;
  emojis: string[];
  colors: [string, string];
}

// Shared by Home and Lab (both call resolvePendingSettlements on their own mount) so the
// "which bet, which team, ask Gemini" logic lives in exactly one place. Best-effort throughout:
// no single-leg winner among the newly-settled bets, no resolvable team (a draw win has none), or
// a failed/empty vibe fetch all just mean no celebration shows — never an error surfaced over
// what should be a purely happy moment.
export async function buildCelebration(newlyWon: PlacedBet[]): Promise<Celebration | null> {
  const candidate = newlyWon.find((b) => b.legs.length === 1);
  if (!candidate) return null;
  const teamName = wonTeamName(candidate.legs[0]);
  if (!teamName) return null;

  try {
    const res = await fetch("/api/celebrate/club-vibe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clubName: teamName }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.vibe || !Array.isArray(data.vibe.emojis) || !Array.isArray(data.vibe.colors)) return null;
    return { teamName, emojis: data.vibe.emojis, colors: [data.vibe.colors[0], data.vibe.colors[1]] };
  } catch {
    return null;
  }
}

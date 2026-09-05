import type { PlacedBet } from "./placedBets";
import { wonTeamName } from "./settlement";

export interface CelebrationTeam {
  name: string;
  emoji: string;
  color: string;
}

export interface Celebration {
  teams: CelebrationTeam[]; // one entry for a single-leg win, one per leg for a parlay
  fallEmojis: string[]; // used for the falling-emoji animation, cycled if there are fewer than needed
  bgColors: [string, string]; // the background gradient's two colors
}

function pickTwoRandom(colors: string[]): [string, string] {
  if (colors.length <= 1) return [colors[0], colors[0]];
  const shuffled = [...colors].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// A single-leg win asks for one club's own rich vibe (5 emojis + 2 colors, both used directly).
async function buildSingleTeamCelebration(bet: PlacedBet): Promise<Celebration | null> {
  const teamName = wonTeamName(bet.legs[0]);
  if (!teamName) return null;

  const data = await postJson<{ vibe: { emojis: string[]; colors: [string, string] } | null }>(
    "/api/celebrate/club-vibe",
    { clubName: teamName }
  );
  if (!data?.vibe) return null;

  return {
    teams: [{ name: teamName, emoji: data.vibe.emojis[0], color: data.vibe.colors[0] }],
    fallEmojis: data.vibe.emojis,
    bgColors: data.vibe.colors,
  };
}

// A multi-leg (parlay) win asks once per team instead — the exact reported ask: get each of the
// teams bet on, one emoji and one color each, then randomly pick 2 of those colors for the
// background rather than always the same two legs' colors in the same order every time.
async function buildMultiTeamCelebration(bet: PlacedBet): Promise<Celebration | null> {
  const teamNames = bet.legs.map((leg) => wonTeamName(leg)).filter((n): n is string => n !== null);
  if (teamNames.length === 0) return null;

  const data = await postJson<{ vibes: { emoji: string; color: string }[] | null }>(
    "/api/celebrate/club-vibes",
    { teamNames }
  );
  if (!data?.vibes || data.vibes.length === 0) return null;

  const teams: CelebrationTeam[] = teamNames.map((name, i) => ({
    name,
    emoji: data.vibes![i]?.emoji ?? "🎉",
    color: data.vibes![i]?.color ?? "#d9b46a",
  }));
  return {
    teams,
    fallEmojis: teams.map((t) => t.emoji),
    bgColors: pickTwoRandom(teams.map((t) => t.color)),
  };
}

// Shared by Home and Lab (both call resolvePendingSettlements on their own mount) so the
// "which bet, which teams, ask Gemini" logic lives in exactly one place. Best-effort throughout:
// no newly-won bet, no resolvable team (a draw leg has none), or a failed/empty vibe fetch all
// just mean no celebration shows — never an error surfaced over what should be a purely happy
// moment. Only the first newly-settled Won bet celebrates, single-leg or parlay alike, whichever
// it is — never a queue of stacked overlays.
export async function buildCelebration(newlyWon: PlacedBet[]): Promise<Celebration | null> {
  const bet = newlyWon[0];
  if (!bet) return null;
  return bet.legs.length === 1 ? buildSingleTeamCelebration(bet) : buildMultiTeamCelebration(bet);
}

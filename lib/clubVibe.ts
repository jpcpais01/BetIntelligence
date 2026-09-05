import { requestJson } from "./openrouter";
import { MODELS } from "./models";

// A small, fun, entirely separate errand from the real analysis pipeline above — same
// request/retry/JSON-parsing core (requestJson), but its own prompt, its own purpose, and never
// the user's selected analysis model: this always asks Gemini specifically, regardless of which
// model is picked for actual match analysis, since "what emojis/colors suit this club" has nothing
// to do with betting analysis at all.
export interface ClubVibe {
  emojis: string[]; // exactly 5
  colors: [string, string];
}

const VIBE_MODEL = MODELS.gemini.openrouterId;

const VIBE_SYSTEM_PROMPT = `You are a quick, fun assistant with one narrow job: given a football (soccer) club's name, respond \
with ONLY a single valid JSON object, no markdown, no commentary, matching exactly this shape: \
{"emojis": string[5], "colors": [string, string]}. "emojis" is exactly 5 emoji characters (emoji only, no words) that capture \
that club's real colors, crest, nickname, or general vibe/identity. "colors" is exactly 2 CSS hex color codes (e.g. "#1a2b3c") \
matching that club's real primary and secondary colors. Nothing else in the response.`;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// Never throws — this is a celebratory flourish, not a core feature, so any failure (rate limit,
// a club the model doesn't recognize, a malformed reply) just means the caller skips the
// celebration entirely rather than surfacing an error over a won bet.
export async function getClubVibe(clubName: string): Promise<ClubVibe | null> {
  try {
    const { parsed } = await requestJson<{ emojis: unknown; colors: unknown }>(
      [
        { role: "system", content: VIBE_SYSTEM_PROMPT },
        { role: "user", content: clubName },
      ],
      false,
      200,
      VIBE_MODEL
    );

    const emojis = isStringArray(parsed.emojis) ? parsed.emojis.filter((e) => e.length > 0) : [];
    const colors = isStringArray(parsed.colors) ? parsed.colors.filter((c) => /^#[0-9a-fA-F]{3,8}$/.test(c)) : [];
    if (emojis.length === 0 || colors.length < 2) return null;

    // The model was asked for exactly 5/2, but never trust that literally — pad a short emoji
    // list by repeating what it did give rather than crashing on an out-of-range index later.
    const fivEmojis = Array.from({ length: 5 }, (_, i) => emojis[i % emojis.length]);
    return { emojis: fivEmojis, colors: [colors[0], colors[1]] };
  } catch {
    return null;
  }
}

// Used under MOCK_AI so the celebration flow is testable without a real OPENROUTER_API_KEY —
// generic celebratory emojis and a warm gold/green pair, not tied to any real club.
export function getMockClubVibe(): ClubVibe {
  return { emojis: ["🎉", "⚽", "🏆", "🔥", "✨"], colors: ["#d9b46a", "#55b98c"] };
}

// One emoji + one color per club, for a multi-leg (parlay) win — each leg backed a different
// team, so this asks once for the whole list rather than once per team. The reply only needs to
// preserve ORDER (matched back to the caller's own team list by index), not echo the team names
// back — one less thing for the model to get slightly wrong on a "just for fun" call.
export interface ClubVibeEntry {
  emoji: string;
  color: string;
}

const VIBES_SYSTEM_PROMPT = `You are a quick, fun assistant with one narrow job: given a JSON array of football (soccer) \
club names, respond with ONLY a single valid JSON object, no markdown, no commentary, matching exactly this shape: \
{"entries": [{"emoji": string, "color": string}, ...]}. Return exactly one entry per club name given, in the exact same \
order — do not skip, merge, or reorder any. "emoji" is exactly one emoji character (emoji only, no words) that captures \
that club's real colors, crest, nickname, or general vibe/identity. "color" is one CSS hex color code (e.g. "#1a2b3c") \
matching that club's real primary color. Nothing else in the response.`;

const FALLBACK_ENTRY: ClubVibeEntry = { emoji: "🎉", color: "#d9b46a" };

export async function getClubVibes(teamNames: string[]): Promise<ClubVibeEntry[] | null> {
  if (teamNames.length === 0) return null;
  try {
    const { parsed } = await requestJson<{ entries: unknown }>(
      [
        { role: "system", content: VIBES_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(teamNames) },
      ],
      false,
      300,
      VIBE_MODEL
    );
    const entries = parsed.entries;
    if (!Array.isArray(entries) || entries.length === 0) return null;

    // Zipped back to the caller's own team list by index — a short, long, or malformed reply
    // never crashes, it just falls back to a generic entry for whatever it didn't cover.
    return teamNames.map((_, i) => {
      const entry = entries[i] as { emoji?: unknown; color?: unknown } | undefined;
      const emoji = typeof entry?.emoji === "string" && entry.emoji.length > 0 ? entry.emoji : FALLBACK_ENTRY.emoji;
      const color = typeof entry?.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(entry.color) ? entry.color : FALLBACK_ENTRY.color;
      return { emoji, color };
    });
  } catch {
    return null;
  }
}

// Used under MOCK_AI — a small fixed palette cycled across however many teams are in the parlay,
// not tied to any real club.
export function getMockClubVibes(teamNames: string[]): ClubVibeEntry[] {
  const palette: ClubVibeEntry[] = [
    { emoji: "⚽", color: "#d9b46a" },
    { emoji: "🔥", color: "#55b98c" },
    { emoji: "🏆", color: "#8fabc4" },
    { emoji: "⭐", color: "#c99aa3" },
  ];
  return teamNames.map((_, i) => palette[i % palette.length]);
}

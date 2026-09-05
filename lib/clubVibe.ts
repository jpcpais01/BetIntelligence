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

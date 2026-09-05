import { getClubVibe, getMockClubVibe, getClubVibes, getMockClubVibes } from "../lib/clubVibe";

process.env.OPENROUTER_API_KEY = "test-key";

function completion(message: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ choices: [{ message, finish_reason: "stop" }] }),
    text: async () => "",
  };
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- A well-formed reply: exactly 5 emojis, 2 hex colors ---
  {
    globalThis.fetch = (async () =>
      completion({
        content: JSON.stringify({ emojis: ["🔴", "⚪", "👹", "🏆", "⚔️"], colors: ["#da020e", "#ffffff"] }),
      })) as unknown as typeof fetch;
    const vibe = await getClubVibe("Manchester United");
    check("returns exactly 5 emojis", vibe?.emojis.length === 5, JSON.stringify(vibe));
    check("returns exactly 2 colors", vibe?.colors.length === 2, JSON.stringify(vibe));
    check("preserves the model's actual emoji choices", vibe?.emojis[0] === "🔴", JSON.stringify(vibe));
    check("preserves the model's actual colors", vibe?.colors[0] === "#da020e" && vibe?.colors[1] === "#ffffff", JSON.stringify(vibe));
  }

  // --- Fewer than 5 emojis: padded by repeating, never crashes on an out-of-range index ---
  {
    globalThis.fetch = (async () =>
      completion({ content: JSON.stringify({ emojis: ["🔵", "⚪"], colors: ["#0000ff", "#ffffff"] }) })) as unknown as typeof fetch;
    const vibe = await getClubVibe("Some Club");
    check("a short emoji list is padded to exactly 5 by repeating", vibe?.emojis.length === 5, JSON.stringify(vibe));
  }

  // --- Fewer than 2 colors, or non-hex colors: rejected entirely rather than guessing ---
  {
    globalThis.fetch = (async () =>
      completion({ content: JSON.stringify({ emojis: ["🔵", "⚪", "🏆", "⚽", "🔥"], colors: ["blue"] }) })) as unknown as typeof fetch;
    const vibe = await getClubVibe("Some Club");
    check("fewer than 2 valid hex colors returns null rather than guessing", vibe === null);
  }

  // --- Malformed/missing fields, a thrown fetch, or a non-ok response all degrade to null —
  // this is a celebratory flourish, never allowed to throw over a won bet ---
  {
    globalThis.fetch = (async () => completion({ content: "not json at all" })) as unknown as typeof fetch;
    let threw = false;
    let vibe = null;
    try {
      vibe = await getClubVibe("Some Club");
    } catch {
      threw = true;
    }
    check("a malformed reply never throws", !threw);
    check("a malformed reply resolves to null", vibe === null);
  }
  {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    let threw = false;
    try {
      await getClubVibe("Some Club");
    } catch {
      threw = true;
    }
    check("a thrown fetch never propagates", !threw);
  }

  // --- Mock mode: works with no real key, always returns a usable shape ---
  {
    const vibe = getMockClubVibe();
    check("mock vibe has exactly 5 emojis", vibe.emojis.length === 5);
    check("mock vibe has exactly 2 colors", vibe.colors.length === 2);
  }

  // --- getClubVibes: one emoji + one color per club, for a parlay win — matched back to the
  // caller's own team list by index rather than trusting the model to echo names correctly ---
  {
    globalThis.fetch = (async () =>
      completion({
        content: JSON.stringify({
          entries: [
            { emoji: "🔴", color: "#da020e" },
            { emoji: "🔵", color: "#034694" },
            { emoji: "⚪", color: "#ffffff" },
          ],
        }),
      })) as unknown as typeof fetch;
    const vibes = await getClubVibes(["Arsenal", "Chelsea", "Real Madrid"]);
    check("returns one entry per team, in the same order", vibes?.length === 3, JSON.stringify(vibes));
    check("preserves each team's own emoji/color by position", vibes?.[1].emoji === "🔵" && vibes?.[1].color === "#034694", JSON.stringify(vibes));
  }
  check("an empty team list returns null rather than calling out for nothing", await getClubVibes([]) === null);
  {
    // A short reply (fewer entries than teams asked about) falls back to a generic entry for
    // whatever it didn't cover, rather than crashing on an out-of-range index.
    globalThis.fetch = (async () =>
      completion({ content: JSON.stringify({ entries: [{ emoji: "🔴", color: "#da020e" }] }) })) as unknown as typeof fetch;
    const vibes = await getClubVibes(["Arsenal", "Chelsea", "Real Madrid"]);
    check("a short reply still returns one entry per team", vibes?.length === 3, JSON.stringify(vibes));
    check("the uncovered teams get the generic fallback entry", vibes?.[2].emoji === "🎉", JSON.stringify(vibes));
  }
  {
    globalThis.fetch = (async () => completion({ content: "not json at all" })) as unknown as typeof fetch;
    let threw = false;
    let vibes = null;
    try {
      vibes = await getClubVibes(["Arsenal", "Chelsea"]);
    } catch {
      threw = true;
    }
    check("a malformed multi-team reply never throws", !threw);
    check("a malformed multi-team reply resolves to null", vibes === null);
  }

  // --- Mock mode for the multi-team path ---
  {
    const vibes = getMockClubVibes(["Arsenal", "Chelsea", "Real Madrid"]);
    check("mock multi-vibe returns one entry per team", vibes.length === 3);
    check("every mock entry has both an emoji and a color", vibes.every((v) => v.emoji.length > 0 && v.color.length > 0));
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll club-vibe cases passed.");
}

run();

import { getClubVibe, getMockClubVibe } from "../lib/clubVibe";

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

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll club-vibe cases passed.");
}

run();

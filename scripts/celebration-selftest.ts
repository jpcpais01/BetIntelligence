import { buildCelebration } from "../lib/celebration";
import type { SlipLeg } from "../lib/betslip";
import type { PlacedBet } from "../lib/placedBets";

function sportsLeg(overrides: Partial<SlipLeg> = {}): SlipLeg {
  return {
    pickId: "p1",
    kind: "sports",
    title: "Arsenal v Chelsea",
    meta: "🏴 Premier League",
    outcomeLabel: "Arsenal",
    marketProb: 0.5,
    aiProb: 0.55,
    league: "premier-league",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    startTime: new Date().toISOString(),
    ...overrides,
  };
}

function fakeBet(legs: SlipLeg[]): PlacedBet {
  return {
    id: "bet-1",
    placedAt: new Date().toISOString(),
    legs,
    combined: { marketProb: 0.5, aiProb: 0.55, edge: 0.05 },
    stake: 100,
    settlement: { status: "won", payout: 200, settledAt: new Date().toISOString() },
  };
}

function ok(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- No newly-won bets at all -> no celebration, no fetch made ---
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return ok({});
    }) as unknown as typeof fetch;
    const result = await buildCelebration([]);
    check("an empty newlyWon list returns null", result === null);
    check("makes no fetch at all when there's nothing to celebrate", calls === 0, String(calls));
  }

  // --- Single-leg win: calls the single-club endpoint, uses its 5 emojis + 2 colors directly ---
  {
    const urls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      urls.push(String(url));
      return ok({ vibe: { emojis: ["🔴", "⚪", "👹", "🏆", "⚔️"], colors: ["#da020e", "#ffffff"] } });
    }) as unknown as typeof fetch;
    const result = await buildCelebration([fakeBet([sportsLeg({ outcomeLabel: "Arsenal" })])]);
    check("calls the single-club-vibe endpoint", urls[0]?.includes("/api/celebrate/club-vibe"), urls[0]);
    check("never calls the multi-team endpoint for a single-leg win", !urls[0]?.includes("club-vibes"), urls[0]);
    check("returns exactly one team", result?.teams.length === 1, JSON.stringify(result));
    check("the team is the one backed", result?.teams[0].name === "Arsenal", JSON.stringify(result));
    check("fallEmojis carries all 5 of the club's emojis", result?.fallEmojis.length === 5, JSON.stringify(result));
    check("bgColors is exactly the club's own 2 colors", JSON.stringify(result?.bgColors) === JSON.stringify(["#da020e", "#ffffff"]), JSON.stringify(result));
  }

  // --- Multi-leg (parlay) win: calls the multi-team endpoint with every backed team, background
  // colors are 2 of the returned per-team colors (order may vary — that's the "randomly chosen" part) ---
  {
    const urls: string[] = [];
    let sentBody: unknown = null;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      urls.push(String(url));
      sentBody = init?.body ? JSON.parse(String(init.body)) : null;
      return ok({
        vibes: [
          { emoji: "🔴", color: "#da020e" },
          { emoji: "🔵", color: "#034694" },
          { emoji: "⚪", color: "#ffffff" },
        ],
      });
    }) as unknown as typeof fetch;

    const parlay = fakeBet([
      sportsLeg({ pickId: "p1", outcomeLabel: "Arsenal" }),
      sportsLeg({ pickId: "p2", outcomeLabel: "Liverpool", homeTeam: "Liverpool", awayTeam: "Everton" }),
      sportsLeg({ pickId: "p3", outcomeLabel: "Real Madrid", homeTeam: "Real Madrid", awayTeam: "Barcelona" }),
    ]);
    const result = await buildCelebration([parlay]);

    check("calls the multi-team-vibes endpoint", urls[0]?.includes("/api/celebrate/club-vibes"), urls[0]);
    check(
      "sends every backed team name, in leg order",
      JSON.stringify((sentBody as { teamNames: string[] })?.teamNames) === JSON.stringify(["Arsenal", "Liverpool", "Real Madrid"]),
      JSON.stringify(sentBody)
    );
    check("returns one team entry per leg", result?.teams.length === 3, JSON.stringify(result));
    check(
      "each team keeps its own emoji/color, matched by position",
      result?.teams[1].name === "Liverpool" && result?.teams[1].color === "#034694",
      JSON.stringify(result)
    );
    check("fallEmojis carries one emoji per team", result?.fallEmojis.length === 3, JSON.stringify(result));
    const allTeamColors = ["#da020e", "#034694", "#ffffff"];
    check(
      "bgColors are 2 colors actually drawn from the teams' own colors, not fabricated",
      !!result && result.bgColors.every((c) => allTeamColors.includes(c)),
      JSON.stringify(result?.bgColors)
    );
  }

  // --- A parlay leg with no resolvable team (a draw bet) is excluded from the team list, not
  // sent to the model and not shown, rather than crashing or fabricating a name for it ---
  {
    let sentBody: unknown = null;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      sentBody = init?.body ? JSON.parse(String(init.body)) : null;
      return ok({ vibes: [{ emoji: "🔴", color: "#da020e" }] });
    }) as unknown as typeof fetch;

    const parlayWithDraw = fakeBet([
      sportsLeg({ pickId: "p1", outcomeLabel: "Arsenal" }),
      sportsLeg({ pickId: "p2", outcomeLabel: "Draw", homeTeam: "Liverpool", awayTeam: "Everton" }),
    ]);
    const result = await buildCelebration([parlayWithDraw]);
    check("a draw leg is excluded from the team list sent to the model", JSON.stringify((sentBody as { teamNames: string[] })?.teamNames) === JSON.stringify(["Arsenal"]), JSON.stringify(sentBody));
    check("the celebration itself only lists the one resolvable team", result?.teams.length === 1, JSON.stringify(result));
  }

  // --- A failed or empty vibe fetch degrades to no celebration, never an error ---
  {
    globalThis.fetch = (async () => ({ ok: false })) as unknown as typeof fetch;
    const result = await buildCelebration([fakeBet([sportsLeg({ outcomeLabel: "Arsenal" })])]);
    check("a failed single-club fetch resolves to null, not a thrown error", result === null);
  }
  {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    let threw = false;
    try {
      await buildCelebration([fakeBet([sportsLeg({ outcomeLabel: "Arsenal" })])]);
    } catch {
      threw = true;
    }
    check("a thrown fetch never propagates out of buildCelebration", !threw);
  }

  // --- Only the FIRST newly-won bet celebrates, never a queue ---
  {
    const urls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      urls.push(String(url));
      return ok({ vibe: { emojis: ["🎉", "⚽", "🏆", "🔥", "✨"], colors: ["#111111", "#222222"] } });
    }) as unknown as typeof fetch;
    await buildCelebration([
      fakeBet([sportsLeg({ outcomeLabel: "Arsenal" })]),
      fakeBet([sportsLeg({ outcomeLabel: "Chelsea" })]),
    ]);
    check("exactly one fetch is made even when several bets newly won", urls.length === 1, String(urls.length));
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll celebration cases passed.");
}

run();

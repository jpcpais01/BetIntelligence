import { buildInjuryDigest, __resetInjuriesCacheForTests } from "../lib/bigBallsData";

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json, text: async () => "" };
}

function injury(opts: { player: string; team: string; reason?: string; expectedReturn?: string }) {
  return {
    player: { name: opts.player },
    team: { name: opts.team },
    reason: opts.reason,
    expectedReturn: opts.expectedReturn,
  };
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- No API key: soft-fails to an honest "not available" line, never throws, never fetches ---
  {
    __resetInjuriesCacheForTests();
    delete process.env.BIG_BALLS_API_KEY;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("should not be called without a key");
    }) as unknown as typeof fetch;
    const digest = await buildInjuryDigest({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league" });
    check("no key -> no fetch call is made", calls === 0);
    check("no key -> digest says injury data isn't available", digest.includes("not available"), digest);
  }

  // --- A league this provider doesn't cover: no fetch call, honest "not available" line ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("should not be called for an unsupported league");
    }) as unknown as typeof fetch;
    const digest = await buildInjuryDigest({ homeTeam: "Ajax", awayTeam: "PSV", league: "eredivisie" });
    check("unsupported league -> no fetch call is made", calls === 0);
    check("unsupported league -> digest says injury data isn't available", digest.includes("not available"), digest);
  }

  // --- A covered league, successful response with injuries for both teams ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    let requestedUrl = "";
    globalThis.fetch = (async (url: unknown) => {
      requestedUrl = String(url);
      return ok({
        data: {
          injuries: [
            injury({ player: "Bukayo Saka", team: "Arsenal", reason: "hamstring", expectedReturn: "2026-10-01" }),
            injury({ player: "Reece James", team: "Chelsea", reason: "knee" }),
          ],
        },
      });
    }) as unknown as typeof fetch;

    const digest = await buildInjuryDigest({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league" });
    check("requests the epl league key for premier-league", requestedUrl.includes("league=epl"), requestedUrl);
    check("home team's injured player appears", digest.includes("Bukayo Saka"), digest);
    check("home team's reason and expected return appear", digest.includes("hamstring") && digest.includes("2026-10-01"), digest);
    check("away team's injured player appears", digest.includes("Reece James"), digest);
    check("away team's reason appears", digest.includes("knee"), digest);
  }

  // --- A covered league, a team with no reported injuries gets an honest per-team line ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      ok({ data: { injuries: [injury({ player: "Erling Haaland", team: "Manchester City", reason: "ankle" })] } })) as unknown as typeof fetch;

    const digest = await buildInjuryDigest({ homeTeam: "Manchester City", awayTeam: "Everton", league: "premier-league" });
    check("the team with an injury shows it", digest.includes("Erling Haaland"), digest);
    check("the team with no injuries gets an honest 'no reported injuries' line", digest.includes("No reported injuries."), digest);
  }

  // --- A full legal name with a founding-year number still matches (shared matching logic) ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      ok({ data: { injuries: [injury({ player: "Karim Adeyemi", team: "Borussia Dortmund", reason: "muscle" })] } })) as unknown as typeof fetch;

    const digest = await buildInjuryDigest({
      homeTeam: "Bayern Munich",
      awayTeam: "BV Borussia 09 Dortmund",
      league: "bundesliga",
    });
    check(
      "a full legal name ('BV Borussia 09 Dortmund') still matches the injury record's team name",
      digest.includes("Karim Adeyemi"),
      digest
    );
  }

  // --- Champions League is covered, using the "ucl" league key ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    let requestedUrl = "";
    globalThis.fetch = (async (url: unknown) => {
      requestedUrl = String(url);
      return ok({ data: { injuries: [] } });
    }) as unknown as typeof fetch;
    await buildInjuryDigest({ homeTeam: "Real Madrid", awayTeam: "Manchester City", league: "champions-league" });
    check("requests the ucl league key for champions-league", requestedUrl.includes("league=ucl"), requestedUrl);
  }

  // --- A non-ok response or thrown fetch both soft-fail rather than throwing ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "unauthorized" })) as unknown as typeof fetch;
    const digest = await buildInjuryDigest({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league" });
    check("a non-ok response soft-fails to 'not available' rather than throwing", digest.includes("not available"), digest);
  }
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    let threw = false;
    let digest = "";
    try {
      digest = await buildInjuryDigest({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league" });
    } catch {
      threw = true;
    }
    check("a thrown fetch never propagates — buildInjuryDigest always resolves", !threw);
    check("a thrown fetch soft-fails to 'not available'", digest.includes("not available"), digest);
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll Big Balls Sports Data cases passed.");
}

run();

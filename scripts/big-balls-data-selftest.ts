import { buildInjuryDigest, fetchInjurySummary, __resetInjuriesCacheForTests } from "../lib/bigBallsData";

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json, text: async () => "" };
}

// Real confirmed shape (via /api/debug/injuries against the live API): a bare "currently
// unavailable" flag with no team name, no reason, and no expected-return date — just an id, a
// display name, and an opaque team id. Team names have to be resolved separately via /teams.
function injury(opts: { id: string; name: string; teamId: string; reason?: string; expectedReturn?: string }) {
  return {
    id: opts.id,
    full_name: opts.name,
    display_name: opts.name,
    current_team_id: opts.teamId,
    reason: opts.reason,
    expectedReturn: opts.expectedReturn,
  };
}

function team(id: string, name: string) {
  return { id, name };
}

function injuriesResponse(records: unknown[]) {
  return ok({ data: { injuries: { value: records, source: "aggregator-paid", via: "cache" } } });
}

function teamsResponse(records: unknown[]) {
  return ok({ data: { teams: { value: records } } });
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

  // --- A covered league, successful response: injuries keyed by opaque team id, resolved to real
  // team names via a separate /teams lookup ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    const urls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      urls.push(u);
      if (u.includes("/injuries")) {
        return injuriesResponse([
          injury({ id: "p1", name: "Bukayo Saka", teamId: "team_arsenal" }),
          injury({ id: "p2", name: "Reece James", teamId: "team_chelsea" }),
        ]);
      }
      if (u.includes("/teams")) {
        return teamsResponse([team("team_arsenal", "Arsenal"), team("team_chelsea", "Chelsea")]);
      }
      throw new Error(`Unhandled URL: ${u}`);
    }) as unknown as typeof fetch;

    const digest = await buildInjuryDigest({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league" });
    check("requests the epl league key on the injuries endpoint", urls.some((u) => u.includes("/injuries") && u.includes("league=epl")), urls.join(" | "));
    check("requests the epl league key on the teams endpoint", urls.some((u) => u.includes("/teams") && u.includes("league=epl")), urls.join(" | "));
    check("home team's injured player appears, resolved via team id", digest.includes("Bukayo Saka"), digest);
    check("away team's injured player appears, resolved via team id", digest.includes("Reece James"), digest);
    check("a record with no reason/status shows an honest bare flag", digest.includes("reported unavailable"), digest);
  }

  // --- A record that DOES carry reason/expected-return (a richer shape, if some league ever
  // returns one) still surfaces that detail rather than the bare fallback ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/injuries")) {
        return injuriesResponse([
          injury({ id: "p3", name: "Erling Haaland", teamId: "team_city", reason: "ankle", expectedReturn: "2026-10-01" }),
        ]);
      }
      if (u.includes("/teams")) return teamsResponse([team("team_city", "Manchester City"), team("team_everton", "Everton")]);
      throw new Error(`Unhandled URL: ${u}`);
    }) as unknown as typeof fetch;

    const digest = await buildInjuryDigest({ homeTeam: "Manchester City", awayTeam: "Everton", league: "premier-league" });
    check("a record with a reason and expected return shows both", digest.includes("ankle") && digest.includes("2026-10-01"), digest);
    check("the team with no injuries gets an honest 'no reported injuries' line", digest.includes("No reported injuries."), digest);
  }

  // --- A full legal name with a founding-year number still matches (shared matching logic) ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/injuries")) return injuriesResponse([injury({ id: "p4", name: "Karim Adeyemi", teamId: "team_bvb" })]);
      if (u.includes("/teams")) return teamsResponse([team("team_bayern", "Bayern Munich"), team("team_bvb", "Borussia Dortmund")]);
      throw new Error(`Unhandled URL: ${u}`);
    }) as unknown as typeof fetch;

    const digest = await buildInjuryDigest({
      homeTeam: "Bayern Munich",
      awayTeam: "BV Borussia 09 Dortmund",
      league: "bundesliga",
    });
    check(
      "a full legal name ('BV Borussia 09 Dortmund') still matches the resolved team name",
      digest.includes("Karim Adeyemi"),
      digest
    );
  }

  // --- Champions League is covered, using the "ucl" league key ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    const urls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      urls.push(u);
      if (u.includes("/injuries")) return injuriesResponse([]);
      if (u.includes("/teams")) return teamsResponse([]);
      throw new Error(`Unhandled URL: ${u}`);
    }) as unknown as typeof fetch;
    await buildInjuryDigest({ homeTeam: "Real Madrid", awayTeam: "Manchester City", league: "champions-league" });
    check("requests the ucl league key for champions-league", urls.some((u) => u.includes("league=ucl")), urls.join(" | "));
  }

  // --- Team-name resolution failing (an empty /teams response) is distinct from no injuries at
  // all — the digest should still surface the unmatched players league-wide rather than silently
  // claiming "no reported injuries" for both teams. ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/injuries")) return injuriesResponse([injury({ id: "p5", name: "Some Player", teamId: "team_x" })]);
      if (u.includes("/teams")) return teamsResponse([]);
      throw new Error(`Unhandled URL: ${u}`);
    }) as unknown as typeof fetch;

    const digest = await buildInjuryDigest({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league" });
    check("team resolution failing still surfaces the player name league-wide", digest.includes("Some Player"), digest);
    check("team resolution failing is flagged explicitly, not silently 'no reported injuries'", digest.includes("Could not map players to specific teams"), digest);
  }

  // --- The real production bug this was built from: the injuries array sits one level deeper
  // than first guessed (data.injuries.value, not data.injuries) — a bare object at data.injuries
  // must never crash, and an unwrapped array is still accepted defensively too. ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/injuries")) return ok({ data: { injuries: { unexpected: "shape" } } });
      if (u.includes("/teams")) return teamsResponse([]);
      throw new Error(`Unhandled URL: ${u}`);
    }) as unknown as typeof fetch;
    let threw = false;
    let digest = "";
    try {
      digest = await buildInjuryDigest({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league" });
    } catch {
      threw = true;
    }
    check("an unexpected (non-array, non-{value}) injuries shape never throws", !threw);
    check("an unexpected shape soft-fails to 'not available'", digest.includes("not available"), digest);
  }
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/injuries")) return ok({ data: { injuries: [injury({ id: "p6", name: "Plain Array Player", teamId: "team_x" })] } });
      if (u.includes("/teams")) return teamsResponse([team("team_x", "Arsenal")]);
      throw new Error(`Unhandled URL: ${u}`);
    }) as unknown as typeof fetch;
    const digest = await buildInjuryDigest({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league" });
    check("a plain (unwrapped) array is also accepted defensively", digest.includes("Plain Array Player"), digest);
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

  // --- fetchInjurySummary: the structured counterpart to buildInjuryDigest's text, used by the
  // analysis UI's injuries infogram. Same underlying data, parallel path — never a second real
  // request (both read the same cached fetchers). ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/injuries")) {
        return injuriesResponse([
          injury({ id: "p1", name: "Bukayo Saka", teamId: "team_arsenal" }),
          injury({ id: "p2", name: "Reece James", teamId: "team_chelsea", reason: "hamstring" }),
        ]);
      }
      if (u.includes("/teams")) return teamsResponse([team("team_arsenal", "Arsenal"), team("team_chelsea", "Chelsea")]);
      throw new Error(`Unhandled URL: ${u}`);
    }) as unknown as typeof fetch;

    const summary = await fetchInjurySummary({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league" });
    check("returns a non-null summary when the league is covered and data resolves", summary !== null);
    check("home team gets its own player, attributed correctly", summary?.home.length === 1 && summary.home[0].name === "Bukayo Saka", JSON.stringify(summary));
    check("away team gets its own player with its real detail, not the bare fallback", summary?.away[0]?.detail === "hamstring", JSON.stringify(summary));
    check("home player with no reason falls back to the honest bare flag", summary?.home[0]?.detail === "reported unavailable", JSON.stringify(summary));
  }

  // --- fetchInjurySummary returns null (not empty arrays) whenever the text digest would have
  // said "not available" — an uncovered league, no data, or team-name resolution failing all mean
  // there's nothing to attribute per-team, so the UI should hide the card entirely rather than
  // show two empty "None reported" lists that would misleadingly imply data was checked. ---
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async () => {
      throw new Error("should not be called for an unsupported league");
    }) as unknown as typeof fetch;
    const summary = await fetchInjurySummary({ homeTeam: "Ajax", awayTeam: "PSV", league: "eredivisie" });
    check("an uncovered league returns null, not empty arrays", summary === null);
  }
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/injuries")) return injuriesResponse([]);
      if (u.includes("/teams")) return teamsResponse([]);
      throw new Error(`Unhandled URL: ${u}`);
    }) as unknown as typeof fetch;
    const summary = await fetchInjurySummary({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league" });
    check("no injuries data at all returns null", summary === null);
  }
  {
    __resetInjuriesCacheForTests();
    process.env.BIG_BALLS_API_KEY = "test-key";
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/injuries")) return injuriesResponse([injury({ id: "p7", name: "Unmatched Player", teamId: "team_x" })]);
      if (u.includes("/teams")) return teamsResponse([]);
      throw new Error(`Unhandled URL: ${u}`);
    }) as unknown as typeof fetch;
    const summary = await fetchInjurySummary({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "premier-league" });
    check("team-name resolution failing returns null rather than guessing a side", summary === null);
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll Big Balls Sports Data cases passed.");
}

run();

import { fetchMatchLineups, getLineupAvailability } from "../lib/lineups";

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function scoreboardEvent(
  id: string,
  home: string | { displayName: string; shortDisplayName?: string },
  away: string | { displayName: string; shortDisplayName?: string }
) {
  const toTeam = (t: string | { displayName: string; shortDisplayName?: string }) => (typeof t === "string" ? { displayName: t } : t);
  return {
    id,
    competitions: [
      {
        competitors: [
          { homeAway: "home", team: toTeam(home) },
          { homeAway: "away", team: toTeam(away) },
        ],
      },
    ],
  };
}

function rosterTeam(homeAway: "home" | "away", formation: string, starters: string[], subs: string[] = []) {
  return {
    homeAway,
    formation,
    roster: [
      ...starters.map((name) => ({ starter: true, athlete: { displayName: name }, position: { abbreviation: "MF" } })),
      ...subs.map((name) => ({ starter: false, athlete: { displayName: name } })),
    ],
  };
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- fetchMatchLineups: happy path, two requests (scoreboard then summary), matched by name ---
  {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      requestedUrls.push(u);
      if (u.includes("/scoreboard?")) {
        return ok({
          events: [
            scoreboardEvent("778", "Manchester City", { displayName: "Wolverhampton Wanderers", shortDisplayName: "Wolves" }),
          ],
        });
      }
      if (u.includes("/summary?event=778")) {
        return ok({
          rosters: [
            rosterTeam("home", "4-2-3-1", ["Home S1", "Home S2"], ["Home Sub"]),
            rosterTeam("away", "3-5-2", ["Away S1"]),
          ],
        });
      }
      throw new Error(`Unhandled URL in test: ${u}`);
    }) as unknown as typeof fetch;

    const lineups = await fetchMatchLineups({
      league: "premier-league",
      homeTeam: "Manchester City",
      awayTeam: "Wolves",
      startTime: "2026-01-15T20:00:00.000Z",
    });

    check("resolves a lineup once ESPN's own event id is matched by team name", lineups !== null, JSON.stringify(lineups));
    check("the home side's formation and starters are parsed", lineups?.home.formation === "4-2-3-1" && lineups?.home.starters.length === 2, JSON.stringify(lineups?.home));
    check("a non-starter on the roster is excluded", lineups?.home.starters.every((p) => p.name !== "Home Sub") ?? false, JSON.stringify(lineups?.home));
    check("the away side is parsed independently", lineups?.away.formation === "3-5-2" && lineups?.away.starters.length === 1, JSON.stringify(lineups?.away));
    check("hits the scoreboard endpoint first, then the matched event's summary", requestedUrls.some((u) => u.includes("/scoreboard?")) && requestedUrls.some((u) => u.includes("/summary?event=778")), JSON.stringify(requestedUrls));
    check(
      "the short name (Wolves) matches the scoreboard's full name (Wolverhampton Wanderers)",
      lineups !== null,
      "team-name matching failed"
    );
  }

  // --- No event found (team names don't match anything on the scoreboard) -> null, not a crash ---
  {
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/scoreboard?")) return ok({ events: [scoreboardEvent("1", "Some Other Team", "Another Team")] });
      throw new Error(`Unhandled URL in test: ${u}`);
    }) as unknown as typeof fetch;

    const lineups = await fetchMatchLineups({
      league: "premier-league",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      startTime: "2026-01-15T20:00:00.000Z",
    });
    check("an unmatched fixture resolves to null rather than throwing", lineups === null);
  }

  // --- A matched event with no lineup posted yet (empty rosters, or missing one side) -> null ---
  {
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/scoreboard?")) return ok({ events: [scoreboardEvent("42", "Arsenal", "Chelsea")] });
      if (u.includes("/summary?event=42")) return ok({ rosters: [] });
      throw new Error(`Unhandled URL in test: ${u}`);
    }) as unknown as typeof fetch;

    const lineups = await fetchMatchLineups({
      league: "premier-league",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      startTime: "2026-01-15T20:00:00.000Z",
    });
    check("a match whose event exists but has no rosters yet resolves to null, not an empty lineup", lineups === null);
  }

  // --- An unrecognized league short-circuits before ever making a request ---
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return ok({ events: [] });
    }) as unknown as typeof fetch;
    const lineups = await fetchMatchLineups({
      league: "not-a-real-league" as never,
      homeTeam: "Ajax",
      awayTeam: "PSV",
      startTime: "2026-01-15T20:00:00.000Z",
    });
    check("an unrecognized league makes no request at all", calls === 0, `${calls}`);
    check("an unrecognized league resolves to null", lineups === null);
  }

  // --- A thrown fetch never propagates ---
  {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    let threw = false;
    try {
      await fetchMatchLineups({
        league: "premier-league",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        startTime: "2026-01-15T20:00:00.000Z",
      });
    } catch {
      threw = true;
    }
    check("a thrown fetch never propagates out of fetchMatchLineups", !threw);
  }

  // --- getLineupAvailability: one scoreboard request per league covered among the given games,
  // one summary request per game whose event could be matched, and a boolean per requested game ---
  {
    const scoreboardCallsByLeague: Record<string, number> = {};
    let summaryCalls = 0;
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/eng.1/scoreboard")) {
        scoreboardCallsByLeague["eng.1"] = (scoreboardCallsByLeague["eng.1"] ?? 0) + 1;
        return ok({
          events: [
            scoreboardEvent("1", "Arsenal", "Chelsea"),
            scoreboardEvent("2", "Liverpool", "Everton"),
          ],
        });
      }
      if (u.includes("/esp.1/scoreboard")) {
        scoreboardCallsByLeague["esp.1"] = (scoreboardCallsByLeague["esp.1"] ?? 0) + 1;
        return ok({ events: [] });
      }
      if (u.includes("/summary?event=1")) {
        summaryCalls++;
        return ok({ rosters: [rosterTeam("home", "4-3-3", ["A"]), rosterTeam("away", "4-3-3", ["B"])] });
      }
      if (u.includes("/summary?event=2")) {
        summaryCalls++;
        return ok({ rosters: [] });
      }
      throw new Error(`Unhandled URL in test: ${u}`);
    }) as unknown as typeof fetch;

    const result = await getLineupAvailability([
      { id: "g1", league: "premier-league", homeTeam: "Arsenal", awayTeam: "Chelsea", startTime: "2026-01-15T20:00:00.000Z" },
      { id: "g2", league: "premier-league", homeTeam: "Liverpool", awayTeam: "Everton", startTime: "2026-01-15T20:00:00.000Z" },
      { id: "g3", league: "la-liga", homeTeam: "Real Madrid", awayTeam: "Barcelona", startTime: "2026-01-15T20:00:00.000Z" },
    ]);

    check("one scoreboard request per league, not per game", scoreboardCallsByLeague["eng.1"] === 1, JSON.stringify(scoreboardCallsByLeague));
    check("a summary request is made for each matched event", summaryCalls === 2, `${summaryCalls}`);
    check("a game with a posted lineup reads true", result.g1 === true, JSON.stringify(result));
    check("a matched event with no rosters yet reads false", result.g2 === false, JSON.stringify(result));
    check("a game whose fixture couldn't be matched reads false, not missing", result.g3 === false, JSON.stringify(result));
  }

  // --- One league's scoreboard failing doesn't break the batch's other leagues ---
  {
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("/eng.1/scoreboard")) throw new Error("simulated network failure");
      if (u.includes("/esp.1/scoreboard")) return ok({ events: [scoreboardEvent("9", "Real Madrid", "Barcelona")] });
      if (u.includes("/summary?event=9")) return ok({ rosters: [rosterTeam("home", "4-3-3", ["A"]), rosterTeam("away", "4-3-3", ["B"])] });
      throw new Error(`Unhandled URL in test: ${u}`);
    }) as unknown as typeof fetch;

    const result = await getLineupAvailability([
      { id: "g1", league: "premier-league", homeTeam: "Arsenal", awayTeam: "Chelsea", startTime: "2026-01-15T20:00:00.000Z" },
      { id: "g2", league: "la-liga", homeTeam: "Real Madrid", awayTeam: "Barcelona", startTime: "2026-01-15T20:00:00.000Z" },
    ]);
    check("a league whose scoreboard fetch throws contributes false rather than crashing the batch", result.g1 === false, JSON.stringify(result));
    check("an unaffected league in the same batch still resolves correctly", result.g2 === true, JSON.stringify(result));
  }

  // --- An empty games list makes no requests and returns an empty map ---
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return ok({ events: [] });
    }) as unknown as typeof fetch;
    const result = await getLineupAvailability([]);
    check("an empty games list makes no requests", calls === 0, `${calls}`);
    check("an empty games list returns an empty map", Object.keys(result).length === 0);
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll lineups cases passed.");
}

run();

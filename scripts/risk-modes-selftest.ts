import { buildRiskSlip } from "../lib/riskModes";
import type { SavedPick, Probabilities } from "../lib/types";

function fakePick(id: string, market: Probabilities, independent: Probabilities): SavedPick {
  return {
    id,
    savedAt: new Date().toISOString(),
    homeTeam: `Home${id}`,
    awayTeam: `Away${id}`,
    leagueName: "Premier League",
    leagueFlag: "🏴",
    startTime: new Date().toISOString(),
    market,
    independent: {
      ...independent,
      confidence: "medium",
      homeAssessment: { pros: [], cons: [] },
      awayAssessment: { pros: [], cons: [] },
      summary: "",
    },
    comparison: {
      edges: { home: 0, draw: 0, away: 0 },
      bestValue: "none",
      confidence: "medium",
      agreesWithMarket: false,
      verdict: "",
    },
  };
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- Calm (favorite-only, 10+ edge) ---
  // Home is the market's favorite (0.50) with a 12-point edge — qualifies.
  const calmQualifies = [
    fakePick("c1", { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.62, draw: 0.2, away: 0.18 }),
    fakePick("c2", { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.62, draw: 0.2, away: 0.18 }),
    fakePick("c3", { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.62, draw: 0.2, away: 0.18 }),
  ];
  const calmResult = buildRiskSlip(calmQualifies, {}, "calm");
  check("calm: 3 qualifying favorites builds a 3-leg slip", calmResult !== null && calmResult.length === 3);
  check(
    "calm: every leg is the market favorite (home), never a combo",
    (calmResult ?? []).every((l) => l.outcomeLabel === "Home" + "c1" || l.outcomeLabel.startsWith("Home")),
  );

  // Same favorite, but only a 7-point edge — should NOT qualify for calm (needs 10+).
  const calmTooSmall = [
    fakePick("s1", { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.57, draw: 0.25, away: 0.18 }),
    fakePick("s2", { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.57, draw: 0.25, away: 0.18 }),
    fakePick("s3", { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.57, draw: 0.25, away: 0.18 }),
  ];
  check("calm: a 7-point favorite edge does not qualify", buildRiskSlip(calmTooSmall, {}, "calm") === null);

  // Same 7-point favorite edge DOES qualify for easy (needs only 5+).
  check("easy: the same 7-point favorite edge qualifies", buildRiskSlip(calmTooSmall, {}, "easy")?.length === 3);

  // --- Favorite-only never picks a combo, even though a combo's market prob is always higher ---
  // Away is the true favorite (0.55); home+draw (1X) is a bigger number (0.45) than draw+away
  // alone but still less than away — the favorite must resolve to "away", not a double-chance combo.
  const favoriteIsAway = [
    fakePick("f1", { home: 0.25, draw: 0.2, away: 0.55 }, { home: 0.2, draw: 0.15, away: 0.65 }),
    fakePick("f2", { home: 0.25, draw: 0.2, away: 0.55 }, { home: 0.2, draw: 0.15, away: 0.65 }),
    fakePick("f3", { home: 0.25, draw: 0.2, away: 0.55 }, { home: 0.2, draw: 0.15, away: 0.65 }),
  ];
  const favoriteResult = buildRiskSlip(favoriteIsAway, {}, "calm");
  check(
    "calm: favorite resolves to the actual market favorite (away), never a combo",
    (favoriteResult ?? []).every((l) => l.outcomeLabel === "Awayf1" || l.outcomeLabel.startsWith("Away")),
  );

  // --- Normal/Risky/Mega: any of the 5 leg types, picks the single best per game ---
  // Home/draw/away edges are all small, but the 1X combo has a big edge — should be picked over
  // the individually-worse legs, and normal/risky/mega should all find it (5+/3+/1+ all clear it).
  const comboIsBest = [
    fakePick("m1", { home: 0.3, draw: 0.3, away: 0.4 }, { home: 0.32, draw: 0.32, away: 0.36 }),
    fakePick("m2", { home: 0.3, draw: 0.3, away: 0.4 }, { home: 0.32, draw: 0.32, away: 0.36 }),
    fakePick("m3", { home: 0.3, draw: 0.3, away: 0.4 }, { home: 0.32, draw: 0.32, away: 0.36 }),
  ];
  // home edge=2, draw edge=2, away edge=-4, 1x edge=4, x2 edge=-2 -> 1X is the best per game.
  const normalResult = buildRiskSlip(comboIsBest, {}, "normal");
  check("normal: picks the 1X combo when it's the best-edge leg", (normalResult ?? []).every((l) => l.outcomeLabel === "1X"));
  check("calm/easy never see this case since it's favorite-only", buildRiskSlip(comboIsBest, {}, "calm") === null);

  // --- Always capped at exactly 3 legs, keeping the highest-edge ones ---
  // 4 qualifying games for "mega" (now a [1, 3)pp window, not just a 1+ floor) should cap down to
  // the best 3, not all 4. Edges are kept entirely inside that window (1.0/1.5/2.0/2.5pp) — spread
  // any wider and the bigger ones stop being "mega" at all under the new ceiling, they become
  // "risky" or higher, which is exactly the point of adding one.
  const fourQualify = [
    fakePick("q1", { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.51, draw: 0.3, away: 0.19 }), // edge 1.0pp
    fakePick("q2", { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.515, draw: 0.3, away: 0.185 }), // edge 1.5pp
    fakePick("q3", { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.52, draw: 0.3, away: 0.18 }), // edge 2.0pp
    fakePick("q4", { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.525, draw: 0.3, away: 0.175 }), // edge 2.5pp (best)
  ];
  const megaResult = buildRiskSlip(fourQualify, {}, "mega");
  check("mega: 4 qualifying games caps down to a 3-leg slip", megaResult !== null && megaResult.length === 3);
  check(
    "mega: capping keeps the 3 highest-edge legs, dropping the weakest",
    (megaResult ?? []).length === 3 && !(megaResult ?? []).some((l) => l.title === "Homeq1 v Awayq1"),
  );

  // The exact reported bug: dozens of qualifying games must still cap at exactly 3, never scale
  // up with however many qualify. Uses "calm" rather than "mega" here — calm is the one mode with
  // no ceiling, so edges climbing all the way to 15pp still land inside a single mode's window,
  // the same way the original version of this test (from before modes had a ceiling at all) relied
  // on "mega" having no ceiling. The capping behavior under test doesn't depend on which mode.
  const fifteenQualify = Array.from({ length: 15 }, (_, i) =>
    fakePick(`w${i}`, { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.5 + (i + 1) * 0.01, draw: 0.3, away: 0.2 - (i + 1) * 0.01 })
  );
  const bigResult = buildRiskSlip(fifteenQualify, {}, "calm");
  check("15 qualifying games still caps at exactly 3 legs, never more", bigResult !== null && bigResult.length === 3);
  check(
    "capping from 15 keeps the 3 highest-edge legs (the last 3 fixtures, edge 13/14/15pp)",
    (bigResult ?? []).map((l) => l.title).sort().join() === ["Homew12 v Awayw12", "Homew13 v Awayw13", "Homew14 v Awayw14"].sort().join(),
  );

  // Fewer than 3 qualifying games at all -> null ("not enough games for this mode").
  check("fewer than 3 qualifying games returns null", buildRiskSlip(fourQualify.slice(0, 2), {}, "mega") === null);
  check("zero picks returns null", buildRiskSlip([], {}, "mega") === null);

  // --- Live prices override the stale snapshot when deciding what qualifies ---
  const livePick = fakePick("l1", { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.51, draw: 0.3, away: 0.19 });
  const livePicks = [livePick, { ...livePick, id: "l2" }, { ...livePick, id: "l3" }];
  // At the stale snapshot price, edge is only ~1pt (fails "risky"'s 3+). A live price crash to 0.44
  // for home opens up a smaller, still-live-priced edge (~7pp) that lands inside risky's own window
  // (3-5pp)... actually lands in easy/normal's 5-10pp window — chosen deliberately to land inside a
  // real tier's range rather than blowing past every ceiling, so this stays a test of "live prices
  // are read", not of the ceiling itself (that's covered separately below).
  const live: Record<string, number> = {};
  for (const p of livePicks) live[`${p.id}:${p.homeTeam}`] = 0.44;
  check("live prices are used to decide qualification, not just the stale snapshot", buildRiskSlip(livePicks, live, "easy")?.length === 3);

  // --- maxEdge: each mode is now a genuine [minEdge, maxEdge) window, not just a floor ---
  // A 21-point favorite edge clears every mode's minEdge, but should now only qualify for "calm"
  // (no ceiling) — every other mode's ceiling sits at or below "calm"'s own 10pp floor.
  const hugeEdge: Record<string, number> = {};
  for (const p of livePicks) hugeEdge[`${p.id}:${p.homeTeam}`] = 0.3; // independent 0.51 - market 0.30 = 21pp
  check("a 21pp edge favorite qualifies for calm (no ceiling)", buildRiskSlip(livePicks, hugeEdge, "calm")?.length === 3);
  check(
    "the same 21pp edge no longer qualifies for easy — it's past easy's own 10pp ceiling",
    buildRiskSlip(livePicks, hugeEdge, "easy") === null
  );
  check(
    "…nor for normal, risky, or mega — all of their ceilings sit at or below 10pp too",
    buildRiskSlip(livePicks, hugeEdge, "normal") === null &&
      buildRiskSlip(livePicks, hugeEdge, "risky") === null &&
      buildRiskSlip(livePicks, hugeEdge, "mega") === null
  );

  // A mid-range edge (7pp) sits inside easy/normal's 5-10pp window but above risky/mega's own
  // ceilings — should qualify for easy and normal, not risky or mega.
  const midEdge: Record<string, number> = {};
  for (const p of livePicks) midEdge[`${p.id}:${p.homeTeam}`] = 0.44; // independent 0.51 - market 0.44 = 7pp
  check("a 7pp edge qualifies for easy", buildRiskSlip(livePicks, midEdge, "easy")?.length === 3);
  check("a 7pp edge qualifies for normal too — same window, favoriteOnly is what actually differs", buildRiskSlip(livePicks, midEdge, "normal")?.length === 3);
  check("a 7pp edge does not qualify for risky — past its 5pp ceiling", buildRiskSlip(livePicks, midEdge, "risky") === null);
  check("a 7pp edge does not qualify for mega either — same reason", buildRiskSlip(livePicks, midEdge, "mega") === null);

  // A 4pp edge sits inside risky's 3-5pp window but below easy/normal's 5pp floor and above mega's
  // 3pp ceiling — should qualify for risky alone.
  const riskyEdge: Record<string, number> = {};
  for (const p of livePicks) riskyEdge[`${p.id}:${p.homeTeam}`] = 0.47; // independent 0.51 - market 0.47 = 4pp
  check("a 4pp edge qualifies for risky alone", buildRiskSlip(livePicks, riskyEdge, "risky")?.length === 3);
  check("a 4pp edge is below easy/normal's own 5pp floor", buildRiskSlip(livePicks, riskyEdge, "easy") === null);
  check("a 4pp edge is past mega's 3pp ceiling", buildRiskSlip(livePicks, riskyEdge, "mega") === null);

  // The boundary itself is exclusive on the top end: exactly 5pp belongs to the tier whose FLOOR is
  // 5pp (easy/normal), not the tier whose ceiling is 5pp (risky) — mirrors how minEdge itself is
  // already inclusive on the bottom end. A dedicated fixture (independent 0.55, market 0.50) rather
  // than reusing livePicks: 0.51 - 0.46 rounds DOWN to just under 0.05 in floating point, which
  // would test the wrong side of the boundary entirely; 0.55 - 0.50 rounds up to just at/over it.
  const boundaryPick = fakePick("bd1", { home: 0.5, draw: 0.3, away: 0.2 }, { home: 0.55, draw: 0.3, away: 0.15 });
  const boundaryPicks = [boundaryPick, { ...boundaryPick, id: "bd2" }, { ...boundaryPick, id: "bd3" }];
  check("an edge exactly on a shared boundary (5pp) belongs to the floor side (easy), not the ceiling side (risky)", buildRiskSlip(boundaryPicks, {}, "easy")?.length === 3);
  check("…and does not also qualify for risky, whose ceiling is that same 5pp", buildRiskSlip(boundaryPicks, {}, "risky") === null);

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll risk-mode cases passed.");
}

run();

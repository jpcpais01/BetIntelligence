import { legFromPick, combineSlip } from "../lib/betslip";
import type { SavedPick } from "../lib/types";

function fakePick(): SavedPick {
  return {
    id: "pick-1",
    savedAt: new Date().toISOString(),
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    leagueName: "Premier League",
    leagueFlag: "🏴",
    startTime: new Date().toISOString(),
    market: { home: 0.41, draw: 0.29, away: 0.3 },
    independent: {
      home: 0.48,
      draw: 0.24,
      away: 0.28,
      confidence: "medium",
      keyFactors: [],
      rationale: "",
    },
    comparison: {
      edges: { home: 0.07, draw: -0.05, away: -0.02 },
      bestValue: "home",
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

  const pick = fakePick();

  // Plain 1X2 legs are unchanged by adding double chance.
  const home = legFromPick(pick, "home");
  check("home leg still uses the team name as its label", home.outcomeLabel === "Arsenal");
  check("home leg AI/market probabilities are untouched", home.aiProb === 0.48 && home.marketProb === 0.41);

  // Double chance is the sum of the two 1X2 outcomes it covers.
  const oneX = legFromPick(pick, "1x");
  check("1X leg is labeled '1X'", oneX.outcomeLabel === "1X");
  check(
    "1X AI probability is home + draw",
    Math.abs(oneX.aiProb - (0.48 + 0.24)) < 1e-9,
    String(oneX.aiProb)
  );
  check(
    "1X market probability is home + draw",
    Math.abs(oneX.marketProb - (0.41 + 0.29)) < 1e-9,
    String(oneX.marketProb)
  );

  const x2 = legFromPick(pick, "x2");
  check("X2 leg is labeled 'X2'", x2.outcomeLabel === "X2");
  check(
    "X2 AI probability is draw + away",
    Math.abs(x2.aiProb - (0.24 + 0.28)) < 1e-9,
    String(x2.aiProb)
  );
  check(
    "X2 market probability is draw + away",
    Math.abs(x2.marketProb - (0.29 + 0.3)) < 1e-9,
    String(x2.marketProb)
  );

  check("1X and X2 both carry the match title/meta like any other leg", oneX.title === "Arsenal v Chelsea" && x2.meta === "🏴 Premier League");

  // A double-chance leg combines with other legs in a parlay exactly like any other leg — the
  // combined math (product of independent probabilities) doesn't know or care that this leg is
  // a sum under the hood.
  const combined = combineSlip([oneX]);
  check("a single-leg slip's combined AI prob equals that leg's own prob", combined.aiProb === oneX.aiProb);
  check("a single-leg slip's combined market prob equals that leg's own prob", combined.marketProb === oneX.marketProb);

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll betslip cases passed.");
}

run();

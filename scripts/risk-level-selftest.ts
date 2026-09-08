import { riskLevelFor, riskLevelLabel, allRiskLevels } from "../lib/riskLevel";

function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // Boundaries mirror lib/riskModes.ts's own Calm/Risky/Mega floors (10/3/1pp), plus one new value
  // (Easy, 7pp) to break the tie that only ever made sense for riskModes' favorite-only axis.
  check("a huge conviction call (15pp edge) is calm", riskLevelFor(0.15) === "calm");
  check("exactly the calm boundary (10pp edge) is still calm", riskLevelFor(0.1) === "calm");
  check("just under the calm boundary (9pp edge) is easy", riskLevelFor(0.09) === "easy");
  check("a solid edge (8pp) is easy", riskLevelFor(0.08) === "easy");
  check("exactly the easy boundary (7pp edge) is still easy", riskLevelFor(0.07) === "easy");
  check("just under the easy boundary (6.9pp edge) is normal", riskLevelFor(0.069) === "normal");
  check("the AI's own roughly-5pp minimum for flagging anything (5pp edge) is normal", riskLevelFor(0.05) === "normal");
  check("just under normal's floor (4pp edge) is risky", riskLevelFor(0.04) === "risky");
  check("exactly risky's floor (3pp edge) is still risky", riskLevelFor(0.03) === "risky");
  check("a marginal edge (2pp) is mega", riskLevelFor(0.02) === "mega");
  check("a barely-there edge (0.5pp) is mega, not a crash", riskLevelFor(0.005) === "mega");
  check("zero edge is mega", riskLevelFor(0) === "mega");
  check("a negative edge (the market moved against an already-made call) is mega, not out of range", riskLevelFor(-0.1) === "mega");
  check("an extreme edge (40pp) is still calm, not out of range", riskLevelFor(0.4) === "calm");

  check("every tier has a non-empty label", allRiskLevels().every((l) => riskLevelLabel(l).length > 0));
  check("there are exactly 5 tiers", allRiskLevels().length === 5, String(allRiskLevels().length));
  check("calm's label reads 'Calm'", riskLevelLabel("calm") === "Calm");
  check("mega's label reads 'Mega'", riskLevelLabel("mega") === "Mega");

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll risk-level cases passed.");
}

run();

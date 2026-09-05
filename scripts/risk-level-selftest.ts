import { riskLevelFor, riskLevelLabel, allRiskLevels } from "../lib/riskLevel";

function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  check("a heavy favorite (85%) is calm", riskLevelFor(0.85) === "calm");
  check("exactly the calm boundary (70%) is still calm", riskLevelFor(0.7) === "calm");
  check("just under the calm boundary (69%) is easy", riskLevelFor(0.69) === "easy");
  check("a mild favorite (60%) is easy", riskLevelFor(0.6) === "easy");
  check("a coin flip (50%) is normal", riskLevelFor(0.5) === "normal");
  check("a mild underdog (30%) is risky", riskLevelFor(0.3) === "risky");
  check("a longshot (10%) is mega", riskLevelFor(0.1) === "mega");
  check("the extreme low end (1%) is still mega, not a crash", riskLevelFor(0.01) === "mega");
  check("the extreme high end (99%) is still calm, not out of range", riskLevelFor(0.99) === "calm");

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

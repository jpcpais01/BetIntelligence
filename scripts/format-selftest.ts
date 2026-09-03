import { formatCostUsd } from "../lib/format";

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // Analysis costs are typically fractions of a cent — precision scales with magnitude so a
  // real cost never silently rounds down to "$0.00".
  check("sub-cent cost gets 4 decimals", formatCostUsd(0.0023) === "$0.0023", formatCostUsd(0.0023) ?? "null");
  check("a cost that would round to 0 at 2dp still shows", formatCostUsd(0.0004) === "$0.0004", formatCostUsd(0.0004) ?? "null");
  check("sub-dollar cost gets 3 decimals", formatCostUsd(0.15) === "$0.150", formatCostUsd(0.15) ?? "null");
  check("dollar-plus cost gets 2 decimals", formatCostUsd(1.2345) === "$1.23", formatCostUsd(1.2345) ?? "null");
  check("exactly zero renders as $0.00, not null", formatCostUsd(0) === "$0.00");

  check("undefined (no cost data, e.g. mock mode) returns null, not '$undefined'", formatCostUsd(undefined) === null);
  check("NaN returns null", formatCostUsd(NaN) === null);
  check("a negative number (malformed data) returns null rather than a nonsense cost", formatCostUsd(-0.01) === null);

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll format cases passed.");
}

run();

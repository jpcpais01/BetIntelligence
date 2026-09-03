import {
  randomDelayMs,
  randomRewardEur,
  formatRewardEur,
  MIN_DELAY_MS,
  MAX_DELAY_MS,
  MIN_REWARD_EUR,
  MAX_REWARD_EUR,
} from "../lib/luckyMoney";

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  const delays = Array.from({ length: 500 }, () => randomDelayMs());
  check("every delay is >= 10s", delays.every((d) => d >= MIN_DELAY_MS));
  check("every delay is <= 30s", delays.every((d) => d <= MAX_DELAY_MS));
  check("delays aren't all identical (actually random)", new Set(delays).size > 1);

  const rewards = Array.from({ length: 500 }, () => randomRewardEur());
  check("every reward is >= 0.0001", rewards.every((r) => r >= MIN_REWARD_EUR));
  check("every reward is <= 0.01", rewards.every((r) => r <= MAX_REWARD_EUR));
  check("rewards aren't all identical (actually random)", new Set(rewards).size > 1);

  check("smallest reward formats with 4 decimals", formatRewardEur(0.0001) === "€0.0001");
  check("largest reward formats with 4 decimals", formatRewardEur(0.01) === "€0.0100");
  check("a mid-range reward isn't truncated to '€0.00'", formatRewardEur(0.0034) === "€0.0034");

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll lucky-money cases passed.");
}

run();

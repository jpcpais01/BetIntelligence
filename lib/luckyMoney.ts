// Tiny gamification easter egg: a flying-money icon appears at random and pays out a token
// "reward" if tapped in time. Deliberately not real money and not persisted anywhere — it's just
// a bit of fun, not a feature that needs to survive a reload or sync across tabs.
export const MIN_DELAY_MS = 10_000;
export const MAX_DELAY_MS = 30_000;
export const MIN_REWARD_EUR = 0.0001;
export const MAX_REWARD_EUR = 0.01;

export function randomDelayMs(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

export function randomRewardEur(): number {
  return MIN_REWARD_EUR + Math.random() * (MAX_REWARD_EUR - MIN_REWARD_EUR);
}

// Rewards are all sub-cent, so a plain 2-decimal format would round every single one to "€0.00" —
// always show 4 decimals instead, the precision the whole 0.0001-0.01 range actually needs.
export function formatRewardEur(amount: number): string {
  return `€${amount.toFixed(4)}`;
}

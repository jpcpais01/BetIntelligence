// Home's paper portfolio: a starting balance (seeded once, on first visit) plus whatever the user
// tops up afterwards via "Add funds". Deposits are deliberately just a running total, never a
// point plotted on the value-over-time graph — lib/portfolioHistory.ts sums them into a flat
// baseline instead, so putting fake money in never looks like a fake trading gain.
const STORAGE_KEY = "betintelligence.portfolio.deposits.v1";
const SEEDED_KEY = "betintelligence.portfolio.seeded.v1";

// A friendly non-zero starting balance so the very first visit to Home has something to show
// rather than a flat €0 line. Seeded exactly once — never re-added on a later visit even if the
// deposits list is somehow empty again (e.g. cleared browser data mid-session in another tab).
export const STARTING_BALANCE = 1000;
export const DEFAULT_STAKE = 10;
export const QUICK_STAKES = [10, 25, 50, 100];

export interface Deposit {
  id: string;
  amount: number;
  at: string;
}

function readRaw(): Deposit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(deposits: Deposit[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(deposits));
  } catch {
    // Best effort only.
  }
}

export function loadDeposits(): Deposit[] {
  if (typeof window === "undefined") return [];
  const existing = readRaw();
  if (existing.length > 0) return existing;

  let alreadySeeded = false;
  try {
    alreadySeeded = window.localStorage.getItem(SEEDED_KEY) === "1";
  } catch {
    alreadySeeded = false;
  }
  if (alreadySeeded) return [];

  const seed: Deposit[] = [{ id: "seed", amount: STARTING_BALANCE, at: new Date().toISOString() }];
  persist(seed);
  try {
    window.localStorage.setItem(SEEDED_KEY, "1");
  } catch {
    // Best effort only.
  }
  return seed;
}

export function addFunds(amount: number): Deposit {
  const deposit: Deposit = { id: `dep-${Date.now()}`, amount, at: new Date().toISOString() };
  persist([...loadDeposits(), deposit]);
  return deposit;
}

export function totalDeposited(deposits: Deposit[]): number {
  return deposits.reduce((sum, d) => sum + d.amount, 0);
}

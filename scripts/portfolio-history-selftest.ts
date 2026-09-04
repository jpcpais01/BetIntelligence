import { buildPortfolioSeries, computeBetValue } from "../lib/portfolioHistory";
import type { Deposit } from "../lib/portfolio";
import type { PlacedBet } from "../lib/placedBets";
import type { SlipLeg, CombinedSlip } from "../lib/betslip";
import type { HistoryPoint } from "../lib/oddsHistory";

const NOW = Date.parse("2024-01-08T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (t: number) => new Date(t).toISOString();

function leg(overrides: Partial<SlipLeg>): SlipLeg {
  return {
    pickId: "p",
    kind: "sports",
    title: "A v B",
    meta: "x",
    outcomeLabel: "A",
    marketProb: 0.4,
    aiProb: 0.5,
    tokenId: null,
    ...overrides,
  };
}

function bet(overrides: Partial<PlacedBet> & { legs: SlipLeg[]; stake: number }): PlacedBet {
  const combined: CombinedSlip = { marketProb: 0.4, aiProb: 0.5, edge: 0.1 };
  return {
    id: "bet",
    placedAt: iso(NOW - DAY),
    combined,
    ...overrides,
  };
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // No bets at all: the series is a flat line at the deposited baseline.
  {
    const deposits: Deposit[] = [{ id: "seed", amount: 1000, at: iso(NOW - 10 * DAY) }];
    const series = buildPortfolioSeries(deposits, [], {}, NOW);
    check("no bets -> every point equals the baseline", series.every((p) => p.value === 1000));
    check("series has at least a start and an end point", series.length >= 2);
  }

  // Deposits are summed into a flat baseline regardless of when they actually happened — a
  // deposit made yesterday must not show up as a spike anywhere in the series.
  {
    const deposits: Deposit[] = [
      { id: "a", amount: 700, at: iso(NOW - 1 * DAY) },
      { id: "b", amount: 300, at: iso(NOW - 6 * DAY) },
    ];
    const series = buildPortfolioSeries(deposits, [], {}, NOW);
    check("deposits are summed at the start, not spiked in at their own timestamp", series.every((p) => p.value === 1000));
  }

  // A single leg with real price data: value should scale by current/entry, and hold at the
  // stake before the bet was even placed.
  {
    const placedAt = NOW - 3 * DAY;
    const oneLeg = leg({ pickId: "p1", outcomeLabel: "A", marketProb: 0.4, tokenId: "tok1" });
    const oneBet = bet({ id: "bet1", placedAt: iso(placedAt), legs: [oneLeg], stake: 100, combined: { marketProb: 0.4, aiProb: 0.5, edge: 0.1 } });
    const priceSeriesByKey: Record<string, HistoryPoint[]> = {
      "p1:A": [
        { t: iso(placedAt), p: 0.4 },
        { t: iso(placedAt + 1 * DAY), p: 0.5 },
        { t: iso(NOW), p: 0.6 },
      ],
    };
    const deposits: Deposit[] = [{ id: "seed", amount: 1000, at: iso(NOW - 10 * DAY) }];
    const series = buildPortfolioSeries(deposits, [oneBet], priceSeriesByKey, NOW);

    check(
      "current value = stake * (current price / entry price)",
      Math.abs(computeBetValue(oneBet, priceSeriesByKey, NOW) - 150) < 1e-9,
      String(computeBetValue(oneBet, priceSeriesByKey, NOW))
    );
    check(
      "between two data points, holds at the earlier one rather than interpolating",
      computeBetValue(oneBet, priceSeriesByKey, placedAt + 12 * 60 * 60 * 1000) === 100
    );
    check("the series' first point (window start, before the bet existed) is just the baseline", series[0].value === 1000);
    check(
      "the series' last point reflects cash spent plus the position's current value",
      Math.abs(series[series.length - 1].value - (1000 - 100 + 150)) < 1e-9
    );
  }

  // A leg with no price data at all (no tokenId, or the fetch came back empty) holds flat at its
  // own stake — never a fabricated number.
  {
    const flatLeg = leg({ pickId: "p2", outcomeLabel: "C", marketProb: 0.3, tokenId: null });
    const flatBet = bet({ id: "bet2", legs: [flatLeg], stake: 50, combined: { marketProb: 0.3, aiProb: 0.35, edge: 0.05 } });
    check("no price series -> value holds at the stake unchanged", computeBetValue(flatBet, {}, NOW) === 50);
  }

  // Multi-leg parlay: the value multiplier is the PRODUCT of each leg's own current/entry ratio.
  {
    const legA = leg({ pickId: "m1", outcomeLabel: "X", marketProb: 0.5, tokenId: "ta" });
    const legB = leg({ pickId: "m2", outcomeLabel: "Y", marketProb: 0.2, tokenId: "tb" });
    const multiBet = bet({ id: "bet3", legs: [legA, legB], stake: 20, combined: { marketProb: 0.1, aiProb: 0.15, edge: 0.05 } });
    const priceSeriesByKey: Record<string, HistoryPoint[]> = {
      "m1:X": [{ t: iso(NOW), p: 0.6 }], // 1.2x
      "m2:Y": [{ t: iso(NOW), p: 0.1 }], // 0.5x
    };
    const value = computeBetValue(multiBet, priceSeriesByKey, NOW);
    check("multi-leg value is the product of each leg's own ratio", Math.abs(value - 20 * 1.2 * 0.5) < 1e-9, String(value));
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll portfolio-history cases passed.");
}

run();

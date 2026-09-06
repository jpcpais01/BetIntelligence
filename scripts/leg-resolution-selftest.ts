// Node has no localStorage — the same in-memory stand-in placed-bets-selftest.ts uses, so
// lib/placedBets.ts runs its real persistence path rather than being mocked away.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const fakeWindow = { localStorage: new MemoryStorage() };
(globalThis as unknown as { window: typeof fakeWindow }).window = fakeWindow;

function resetStorage(): void {
  fakeWindow.localStorage = new MemoryStorage();
}

import { placeBet, type PlacedBet } from "../lib/placedBets";
import { resolvePendingSettlements } from "../lib/settlement";
import { resolvedLegOutcomes } from "../lib/edgeScore";
import type { SlipLeg, CombinedSlip } from "../lib/betslip";
import type { LiveScoreEntry } from "../lib/liveScores";

const DAY = 24 * 60 * 60 * 1000;

interface FetchCall {
  refs: { league: string; earliestKickoff: string }[];
}

// Stands in for POST /api/bets/settlement-scores, recording what was actually asked about so a
// test can assert which legs are still being chased — not just what came back.
function mockScoresFetch(scores: LiveScoreEntry[], calls: FetchCall[]): typeof fetch {
  return (async (_url: unknown, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as FetchCall) : { refs: [] };
    calls.push(body);
    return {
      ok: true,
      json: async () => ({ scores }),
    } as unknown as Response;
  }) as typeof fetch;
}

function leg(overrides: Partial<SlipLeg> = {}): SlipLeg {
  return {
    pickId: "p1",
    kind: "sports",
    title: "Arsenal v Chelsea",
    meta: "🏴 Premier League",
    outcomeLabel: "Arsenal",
    marketProb: 0.5,
    aiProb: 0.55,
    league: "premier-league",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    startTime: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function finished(overrides: Partial<LiveScoreEntry>): LiveScoreEntry {
  return {
    league: "premier-league",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    status: "FINISHED",
    statusLabel: "Finished",
    homeGoals: 0,
    awayGoals: 1,
    clockLabel: "FT",
    ...overrides,
  } as LiveScoreEntry;
}

const combined: CombinedSlip = { marketProb: 0.25, aiProb: 0.3, edge: 0.05 };

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- The reported bug: a parlay settles LOST the moment one leg loses, but its OTHER legs may
  // not even have kicked off yet. Those have to keep resolving — a leg that goes on to win is
  // still a call that came in, and it has to show green and count toward the Edge Score. ---
  {
    resetStorage();
    // Leg A already played and lost. Leg B kicks off later and hasn't finished at round 1.
    const legA = leg({ pickId: "game-a", outcomeLabel: "Arsenal", homeTeam: "Arsenal", awayTeam: "Chelsea" });
    const legB = leg({
      pickId: "game-b",
      title: "Liverpool v Everton",
      outcomeLabel: "Liverpool",
      homeTeam: "Liverpool",
      awayTeam: "Everton",
      marketProb: 0.5,
    });
    const bet = placeBet([legA, legB], combined, 10);

    // Round 1: only match A has a final score, and it went against the bet.
    const round1Calls: FetchCall[] = [];
    globalThis.fetch = mockScoresFetch(
      [finished({ homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 0, awayGoals: 1 })],
      round1Calls
    );
    const afterRound1 = await resolvePendingSettlements([bet]);
    const bet1 = afterRound1.bets.find((b) => b.id === bet.id) as PlacedBet;

    check("the parlay settles LOST as soon as its first leg loses", bet1.settlement?.status === "lost", JSON.stringify(bet1.settlement));
    check("the lost leg is recorded as lost", bet1.legResults?.[0] === "lost", JSON.stringify(bet1.legResults));
    check("the leg whose match hasn't finished is still pending", bet1.legResults?.[1] === "pending", JSON.stringify(bet1.legResults));

    // Round 2: match B is now finished too, and it went the bet's way.
    const round2Calls: FetchCall[] = [];
    globalThis.fetch = mockScoresFetch(
      [
        finished({ homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 0, awayGoals: 1 }),
        finished({ homeTeam: "Liverpool", awayTeam: "Everton", homeGoals: 3, awayGoals: 0 }),
      ],
      round2Calls
    );
    const afterRound2 = await resolvePendingSettlements(afterRound1.bets);
    const bet2 = afterRound2.bets.find((b) => b.id === bet.id) as PlacedBet;

    check(
      "an already-settled bet's still-open leg is STILL asked about (the whole bug: it used to be skipped outright)",
      round2Calls.length === 1 && round2Calls[0].refs.length > 0,
      JSON.stringify(round2Calls)
    );
    check(
      "the leg that went on to win is now recorded as won, not frozen at pending",
      bet2.legResults?.[1] === "won",
      JSON.stringify(bet2.legResults)
    );
    check("the already-lost leg keeps its own result", bet2.legResults?.[0] === "lost", JSON.stringify(bet2.legResults));

    // The bet's own fate must NOT move — a lost parlay stays lost however well its other legs did.
    check("the bet itself is still LOST, never re-settled by a leg winning later", bet2.settlement?.status === "lost", JSON.stringify(bet2.settlement));
    check("its payout is still zero", bet2.settlement?.payout === 0, String(bet2.settlement?.payout));
    check(
      "settledAt is untouched — the bet settled once, at the moment it actually settled",
      bet2.settlement?.settledAt === bet1.settlement?.settledAt
    );
    check("resolving a later leg never reports the bet as newly won", afterRound2.newlyWon.length === 0);

    // And the point of all of it: both calls now count toward the Edge Score, where before the
    // winning one was invisible because it never left "pending".
    const outcomes = resolvedLegOutcomes([bet2]);
    check("both legs now count toward the Edge Score, not just the losing one", outcomes.length === 2, JSON.stringify(outcomes));
    check("the winning leg counts as a win", outcomes.some((o) => o.won), JSON.stringify(outcomes));
  }

  // --- A leg already resolved is never re-asked about, settled bet or not — that's what keeps the
  // recurring check cheap rather than re-fetching every match ever bet on. ---
  {
    resetStorage();
    const bothDone = placeBet(
      [
        leg({ pickId: "game-a", outcomeLabel: "Arsenal" }),
        leg({ pickId: "game-b", title: "Liverpool v Everton", outcomeLabel: "Liverpool", homeTeam: "Liverpool", awayTeam: "Everton" }),
      ],
      combined,
      10
    );
    const calls: FetchCall[] = [];
    globalThis.fetch = mockScoresFetch(
      [
        finished({ homeTeam: "Arsenal", awayTeam: "Chelsea", homeGoals: 3, awayGoals: 0 }),
        finished({ homeTeam: "Liverpool", awayTeam: "Everton", homeGoals: 3, awayGoals: 0 }),
      ],
      calls
    );
    const first = await resolvePendingSettlements([bothDone]);
    const settled = first.bets.find((b) => b.id === bothDone.id) as PlacedBet;
    check("every leg won, so the bet settles WON", settled.settlement?.status === "won", JSON.stringify(settled.settlement));
    check("a winning parlay is reported as newly won", first.newlyWon.length === 1);

    const callsAfter: FetchCall[] = [];
    globalThis.fetch = mockScoresFetch([], callsAfter);
    await resolvePendingSettlements(first.bets);
    check(
      "with every leg already resolved, nothing is fetched at all on the next check",
      callsAfter.length === 0,
      JSON.stringify(callsAfter)
    );
  }

  // --- A pending leg whose match is older than the server's own lookback can never come back with
  // a result, so it stops being chased rather than keeping its league in the poll forever. ---
  {
    resetStorage();
    const ancient = placeBet(
      [leg({ pickId: "old-game", startTime: new Date(Date.now() - 40 * DAY).toISOString() })],
      combined,
      10
    );
    const calls: FetchCall[] = [];
    globalThis.fetch = mockScoresFetch([], calls);
    await resolvePendingSettlements([ancient]);
    check(
      "a leg far past the settlement lookback window is no longer fetched for",
      calls.length === 0,
      JSON.stringify(calls)
    );

    resetStorage();
    const recent = placeBet([leg({ pickId: "recent-game", startTime: new Date(Date.now() - 2 * DAY).toISOString() })], combined, 10);
    const recentCalls: FetchCall[] = [];
    globalThis.fetch = mockScoresFetch([], recentCalls);
    await resolvePendingSettlements([recent]);
    check(
      "a leg still inside that window is fetched for as normal",
      recentCalls.length === 1,
      JSON.stringify(recentCalls)
    );
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll leg-resolution cases passed.");
}

run();

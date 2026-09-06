import {
  hasKickedOff,
  isOverByClock,
  isMatchOver,
  isLiveCandidate,
  MATCH_OVER_AFTER_MS,
} from "../lib/matchClock";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function isoFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- hasKickedOff: a plain "is it underway", no grace period ---
  check("a match that started 1h ago has kicked off", hasKickedOff(isoAgo(HOUR)));
  check("a match starting in 2h has not kicked off", !hasKickedOff(isoFromNow(2 * HOUR)));
  check("a match starting this exact instant has kicked off", hasKickedOff(new Date().toISOString()));
  check("a missing kickoff time never counts as kicked off", !hasKickedOff(undefined));
  check("an unparseable kickoff time never counts as kicked off", !hasKickedOff("not a date"));

  // --- isOverByClock: the fallback when there's no real status to consult ---
  check("a match 1h in is not over by the clock", !isOverByClock(isoAgo(HOUR)));
  check("a match 2h in is still not over (stoppage/delays)", !isOverByClock(isoAgo(2 * HOUR)));
  check("a match past the full window is over by the clock", isOverByClock(isoAgo(MATCH_OVER_AFTER_MS + MINUTE)));
  check("an upcoming match is never over by the clock", !isOverByClock(isoFromNow(2 * HOUR)));
  check("a missing kickoff time is never over by the clock", !isOverByClock(undefined));

  // --- isMatchOver: real status wins, clock is the backstop ---
  check("a FINISHED status ends the match immediately, however recent", isMatchOver(isoAgo(MINUTE), "FINISHED"));
  check("an IN_PLAY match an hour in is not over", !isMatchOver(isoAgo(HOUR), "IN_PLAY"));
  check("a PAUSED (half time) match is not over", !isMatchOver(isoAgo(HOUR), "PAUSED"));
  check("no status at all falls back to the clock", !isMatchOver(isoAgo(HOUR), undefined));
  check("no status at all, past the window, is over", isMatchOver(isoAgo(MATCH_OVER_AFTER_MS + MINUTE), undefined));
  // The backstop matters both ways: a provider that stops updating (or an abandoned match) would
  // otherwise leave a game stuck "in play" on the list forever.
  check(
    "a stale IN_PLAY status is still overridden by the clock backstop",
    isMatchOver(isoAgo(MATCH_OVER_AFTER_MS + HOUR), "IN_PLAY")
  );

  // --- isLiveCandidate: which matches are worth spending a request on ---
  check("a match 10 minutes from kickoff is already worth polling", isLiveCandidate(isoFromNow(10 * MINUTE), undefined));
  check("a match 2h from kickoff is not worth polling yet", !isLiveCandidate(isoFromNow(2 * HOUR), undefined));
  check("a match underway is worth polling", isLiveCandidate(isoAgo(HOUR), "IN_PLAY"));
  check(
    "a match confirmed finished stops being polled, without waiting for the clock",
    !isLiveCandidate(isoAgo(HOUR), "FINISHED")
  );
  check(
    "a match with no status stops being polled once the clock says it's over",
    !isLiveCandidate(isoAgo(MATCH_OVER_AFTER_MS + MINUTE), undefined)
  );

  // --- The invariant the Sports page depends on: anything still worth polling is still shown ---
  // (a candidate that had already been hidden would be a request spent on nothing).
  for (const [label, startTime, status] of [
    ["about to start", isoFromNow(5 * MINUTE), undefined],
    ["in play", isoAgo(HOUR), "IN_PLAY"],
    ["at half time", isoAgo(70 * MINUTE), "PAUSED"],
    ["underway, no coverage", isoAgo(2 * HOUR), undefined],
  ] as const) {
    check(
      `a match ${label} is still on the list while it's still being polled`,
      !isLiveCandidate(startTime, status) || !isMatchOver(startTime, status)
    );
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll match-clock cases passed.");
}

run();

// Where a match sits in its lifecycle: upcoming -> kicked off -> over. One shared source of
// truth, because "how long after kickoff is a match definitely finished?" was previously answered
// by four separate hardcoded numbers that had quietly drifted apart (3h for pruning a saved pick,
// 3h for bounding live-odds polling, 24h for keeping a game on the list, 24h for polling its
// score) — which is what let a finished match sit on the Sports list for the rest of the day
// showing no result at all.

// 90 minutes of football, plus half time, stoppage and any realistic delay, is comfortably under
// two and a half hours; this rounds up from there. Deliberately a plain kickoff-time heuristic
// rather than a real status check: it's the fallback for when no real status is available (a
// league football-data.org doesn't cover, or a fixture it didn't return), and every caller that
// DOES have a real status checks that first.
export const MATCH_OVER_AFTER_MS = 3 * 60 * 60 * 1000;

// Live coverage is worth requesting slightly before the whistle, so a match going live while
// you're watching gets picked up promptly rather than waiting on the next full refresh.
export const KICKOFF_LOOKAHEAD_MS = 15 * 60 * 1000;

function kickoffMs(startTime: string | undefined): number | null {
  if (!startTime) return null;
  const t = new Date(startTime).getTime();
  return Number.isFinite(t) ? t : null;
}

export function hasKickedOff(startTime: string | undefined, now: number = Date.now()): boolean {
  const t = kickoffMs(startTime);
  return t !== null && t <= now;
}

// "Enough time has passed that this match cannot still be playing." Callers holding a real
// provider status should prefer that; this is what answers the question when there isn't one.
export function isOverByClock(startTime: string | undefined, now: number = Date.now()): boolean {
  const t = kickoffMs(startTime);
  return t !== null && now - t >= MATCH_OVER_AFTER_MS;
}

// The full answer, real status first and the clock as a backstop. The backstop matters both ways:
// without it an abandoned match (or a provider that simply stops updating) would stay "in play"
// on screen forever, and a league with no coverage at all would never resolve.
export function isMatchOver(
  startTime: string | undefined,
  status: string | undefined,
  now: number = Date.now()
): boolean {
  if (status === "FINISHED") return true;
  return isOverByClock(startTime, now);
}

// Worth asking a live-score provider about: from shortly before kickoff until the match is over.
// Note this deliberately takes the same `status` as isMatchOver, so a match stops being polled the
// moment it's confirmed finished rather than being re-requested pointlessly until the clock
// backstop catches up.
export function isLiveCandidate(
  startTime: string | undefined,
  status: string | undefined,
  now: number = Date.now()
): boolean {
  const t = kickoffMs(startTime);
  if (t === null) return false;
  if (t > now + KICKOFF_LOOKAHEAD_MS) return false;
  return !isMatchOver(startTime, status, now);
}

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

// How long a saved pick (Picks tab) stays around after its match is over, before actually being
// removed — measured from KICKOFF, same as MATCH_OVER_AFTER_MS itself, since there's no real
// "confirmed finished at" timestamp tracked anywhere for a match settled via the clock backstop
// rather than a real status. A finished match is still worth a glance (the final score, the
// pre-match read that turned out right or wrong) for a full day afterward, not gone the instant
// its market closes.
export const MATCH_REMOVED_AFTER_MS = MATCH_OVER_AFTER_MS + 24 * 60 * 60 * 1000;

export function isPastRetentionWindow(startTime: string | undefined, now: number = Date.now()): boolean {
  const t = kickoffMs(startTime);
  return t !== null && now - t >= MATCH_REMOVED_AFTER_MS;
}

// How close a finished pick is to actually being removed — for the Picks tab's fading-away
// countdown, not for deciding whether to hide anything (that's isPastRetentionWindow above; this
// is purely descriptive). `remainingMs` is time-to-removal, always accurate since removal itself
// is fixed at kickoff + MATCH_REMOVED_AFTER_MS regardless of when a card started looking
// "finished" (a real confirmed-FINISHED status usually lands well before the 3h clock backstop
// does). `elapsedFraction` (0-1) is how far through the fixed 24h fade window (MATCH_OVER_AFTER_MS
// to MATCH_REMOVED_AFTER_MS) `now` sits, clamped to 0 if a real status already called it finished
// before that window even opened — a full countdown bar is a reasonable default there, not a bug.
// Returns null only for a pick with no usable kickoff time at all; the caller (PickCard) already
// knows whether a match counts as finished and decides on its own whether to show this at all.
export function retentionCountdown(
  startTime: string | undefined,
  now: number = Date.now()
): { remainingMs: number; elapsedFraction: number } | null {
  const t = kickoffMs(startTime);
  if (t === null) return null;
  const overAt = t + MATCH_OVER_AFTER_MS;
  const removedAt = t + MATCH_REMOVED_AFTER_MS;
  const fadeWindowMs = MATCH_REMOVED_AFTER_MS - MATCH_OVER_AFTER_MS;
  return {
    remainingMs: Math.max(0, removedAt - now),
    elapsedFraction: Math.min(1, Math.max(0, (now - overAt) / fadeWindowMs)),
  };
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

# BetIntelligence

AI odds-intelligence for Polymarket prediction markets. **Home** (`/`, the app's default tab) is
your paper-trading portfolio — see below. **Sports** is the app's focus: upcoming 1X2 matches from
Polymarket's top 8 European football leagues, with an LLM independently researching and forming
its own probability read on a match before it ever sees Polymarket's price, then comparing the two
to flag matches that might be mispriced.

This is a paper-trading / research tool: there is no real-money betting. "Saving a pick" just
stores your AI's read in your browser's local storage, and **Home**'s portfolio balance is play
money you can top up freely — see below.

## Discover (currently deactivated)

**Discover** was the app's second, more general tab — a trending feed of Polymarket's
highest-volume markets across every non-football category (politics, crypto, business,
entertainment, science, ...), analyzed with the same independent-research-then-compare flow
generalized for markets with anywhere from 2 (Yes/No) to a dozen-plus named outcomes. It's hidden
and deactivated for now: it no longer has a **Bottom navigation** entry, and its route
(`app/discover/page.tsx`) redirects straight to Home rather than rendering, so a stale bookmark or
the browser's back button can't reach it either. Nothing about it was deleted — the full
implementation (`lib/allMarkets.ts`, `lib/openrouterMarkets.ts`, `/api/markets`,
`/api/analyze/market/predict`, `/api/analyze/market/compare`, `lib/marketPicks.ts`,
`components/MarketCard.tsx`/`MarketAnalysisSheet.tsx`/`MarketPickDetailSheet.tsx`, and more) is
still in the codebase, just not wired up to any page right now, and any market pick or bet placed
on it before deactivation is untouched in storage — **Picks** and **Lab** simply don't read
`lib/marketPicks.ts` anymore while this is off. Re-enabling it is a matter of restoring
`app/discover/page.tsx`'s original component and its `BottomNav.tsx` entry — both recoverable from
git history.

## Sports

The **Sports** tab (`app/sports/page.tsx`) is the original football-only experience — see below
for how its AI analysis, filtering, and caching work.

### A match's lifecycle: upcoming, live, gone

Sports lists matches you can still act on. Once a match is **over it drops off the list entirely**,
rather than sitting there for the rest of the day showing odds nobody can bet into.

"Over" is answered in exactly one place, `lib/matchClock.ts`, and everything else defers to it:

- The real provider status wins when there is one — a match football-data.org reports as
  `FINISHED` is over the moment it says so, however recently it kicked off.
- The kickoff clock is the backstop everywhere else (`MATCH_OVER_AFTER_MS`, 3h — 90 minutes plus
  half time, stoppage and any realistic delay, rounded up). It covers leagues the provider doesn't,
  fixtures it didn't return, and the case where it simply stops updating: without it, an abandoned
  match would stay "in play" on screen forever.

That single definition also decides when a saved pick is pruned (`pruneFinishedPicks`), how long
`mergeGames` keeps carrying a game the upstream feed has dropped, when live-score polling stops,
and when a bet is allowed to settle from market prices. It used to be four different hardcoded
numbers — 3h in two places, 24h in two others — and the mismatch was the bug: score polling gave up
at 6h while the card stayed on screen for 24h, so a finished match spent the rest of the day
displaying its pre-match kickoff time and never a result.

Because kickoff and full time are moments that pass with no data arriving to announce them, the
page keeps its own 30-second clock tick, so a match appears and disappears on time rather than
whenever some unrelated fetch happens to land.

### Live scores on the card

A card's full odds refresh happens only every 30 minutes (see
[Filtering and refreshing](#filtering-and-refreshing)) — fine for pre-match prices, but a "LIVE NOW"
label with no score would go stale the moment the first goal went in. From 15 minutes before
kickoff until the match is over, the page polls `/api/games/live-scores` every 60 seconds, sending
only the leagues that actually have a match in play right now — checking every covered league
regardless of what's showing used to be most of the free tier's entire 10-requests/minute budget by
itself, crowding out real analysis into 429s. The poll interval matches the server's own per-league
cache TTL exactly, so each poll gets genuinely fresh data at a predictable cost of one request per
live league per minute, leaving most of the budget for analysis.

That budget is still shared with the AI analysis pipeline, though, and analysis can burn through
most of it at once — a single match's digest alone is 4-5 requests, so a batch analysis of several
matches can be 30-50. A live-score (or [settlement](#settling-football-bets-against-the-real-result))
request that queued behind that, waiting for its own turn at the budget, would sit there past its
own API route's server timeout and get killed with nothing to show for it — which looks exactly
like "live scores just don't work," when the real cause was contention with an unrelated feature
sharing the same budget. So this one call is **best-effort**: it claims a slot only if one is free
right now, and if the budget is fully claimed it fails immediately rather than queuing — costing
nothing, since the next poll tries again in 60 seconds regardless. Only requests a user is directly
waiting on (an Analyze tap) keep the patient, queuing behavior, where a slower real answer beats a
fast empty one. Every failure here — a busy budget, a missing API key, an actual network error — is
also now logged server-side; before this it failed completely silently, which made "why don't live
scores show up" impossible to actually diagnose from the outside.

The result replaces the guessed "LIVE NOW" badge with the real thing — "LIVE 2-1", "HT 1-0",
"FT 3-1" — and is what tells the page a match is finished so it can drop off the list. Two more
details that were previously wrong here, and are worth knowing about:

- **Results are merged, never replaced.** Each poll only covers the leagues in play at that moment,
  so overwriting the whole set wiped every result belonging to a league that had just stopped being
  polled. That's what made a settled "FT 2-1" flip back to showing a kickoff time, and what let a
  match already known to be finished reappear on the list.
- **Clubs are matched on both of the provider's names.** football-data.org returns a full legal name
  and a short one, and for a good few clubs only the short form is recognisable from Polymarket's
  naming — nothing matches "Wolverhampton Wanderers FC" to "Wolves", "Tottenham Hotspur FC" to
  "Spurs", or "FC Internazionale Milano" to "Inter Milan". Checking only the full name meant those
  clubs silently had no live score *and* [never settled](#settling-football-bets-against-the-real-result),
  while every other club worked fine — which is exactly what made it look intermittent.

`MOCK_GAMES=1` skips this entirely, since mock fixtures carry real club names but synthetic kickoff
times and would otherwise risk picking up an unrelated real match between two same-named clubs.

### Live odds once a match kicks off

Odds move fast once a match is actually underway, and the 30-minute refresh alone would show a
stale price for most of the game. For any game on the list that has kicked off — so never one
that's already over — the page polls `/api/games/live-odds` every 5 seconds: a single bounded,
page-0-only request per distinct league, reusing the exact same tag-slug/series-id fetch strategies
and event parser `getUpcomingGames` itself relies on, rather than the full multi-strategy sweep
(too expensive to repeat every 5 seconds). Polymarket has no comparable rate limit, which is why
this can be so much tighter than the score poll above. A partner league's series id (Premier
League, La Liga, Serie A) is resolved once and cached, not rediscovered on every poll. A game not
returned (its league not currently live, or between polls) just keeps its last known odds.

Both polls subscribe on a joined *string* key rather than a freshly-built array. That sounds like a
detail, but depending on the array meant every incoming score rebuilt it, tore down both intervals
and restarted them — so neither poll ever actually ran at its own stated cadence.

### A recently-kicked-off game doesn't vanish from the list

`getUpcomingGames` (`lib/polymarket.ts`) asks Polymarket for events with `closed:"false"`, and
Polymarket flips that flag within hours of kickoff — well before the match itself is done. Left
alone, that meant a full refresh (every 30 minutes, or on tab focus) would drop a game mid-match,
the instant Polymarket stopped offering it. `mergeGames` (`lib/gamesCache.ts`) fixes this
client-side rather than guessing at Polymarket's exact timing: each refresh merges the fresh fetch
with whatever was already on screen, keeping a match that has kicked off but isn't over yet.

Two things are deliberately *not* preserved: a game that hasn't started and is simply missing from a
fresh fetch (that's a real removal — delisted, filters changed), and one that's already over (the
list hides those anyway, so carrying them further would be work nothing consumes).

The server keeps its own wider 24-hour grace (`withinWindow`) for a different reason: when a
kickoff time has to be recovered from a question's date text it has no time of day and lands at
00:00 UTC, so a tight server-side window would drop real fixtures. The client, which has the real
status, does the precise filtering.

### Stale analysis disappears at kickoff

The "AI last said" panel a card shows (see below) reflects whatever the match looked like *before*
kickoff — once the game actually starts, that read no longer accounts for the live score or a
possibly different squad, so the card stops showing it rather than presenting a stale pre-match take
as if it were still current. Re-running Analyze after kickoff produces a fresh read — one whose
research digest already reflects the live match status and score (see
[How the AI analysis works](#how-the-ai-analysis-works)) — which then shows normally on the card
until the *next* time this match starts (i.e., never again, for a finished one-off fixture). Nothing
is deleted from storage; the panel just isn't rendered once `game.startTime` has passed.

## Picks and Lab: one shared view across both

With Discover deactivated (see above), both pages are football-only for now — no **All /
Football** filter, since there's nothing else to filter between:

- **Picks** lists every saved football analysis, sorted by when you saved it; tapping any card
  reopens its full analysis report (independent read, key factors, sources, market comparison,
  verdict — everything shown live while it was analyzing, plus the multi-run breakdown if it was
  researched more than once) in a read-only detail sheet (`components/PickDetailSheet.tsx`).
- **Lab** (formerly "Slip") builds a single or multi-leg (parlay) bet from any combination of your
  saved football picks, then lets you place it as a paper bet — see below for how it looks and
  works.

Any market pick saved from Discover before it was deactivated stays in `lib/marketPicks.ts`
untouched — it's just not read or shown by either page while Discover is off.

A saved football pick is pruned automatically once its match has finished — there's nothing left
to bet on, so keeping the analysis around is just clutter, unlike a placed bet (which stays as a
permanent record even after settling). `pruneFinishedPicks` (`lib/picks.ts`) is called in place of
a plain load by both Picks and Lab, so a stale entry is actually removed from storage (not just
hidden) the moment either page next opens. Whether a match has finished is a plain kickoff-time
heuristic (3+ hours past kickoff, comfortably longer than any real match takes) rather than a real
status check — unlike settlement, getting this wrong costs nothing worse than a free re-analysis,
so it isn't worth an extra network round-trip on every page load for the rare edge case (a
postponed match) it could get wrong.

Lab goes a step further for its own **Build** tab: a match that's merely *started* (kickoff has
passed at all, `hasKickedOff`) is filtered out of the buildable list the moment Lab loads, well
before pruneFinishedPicks' 3-hour mark ever deletes it — Lab is a "build a new bet" tool, so a
game already underway isn't something you can act on anymore, even though Picks still shows it as
recent analysis history in the meantime. Any leg already sitting in the draft slip for a match that
has since kicked off is removed the same way, so the slip never carries something no longer
placeable.

### Lab: a sportsbook-style slip

Lab is deliberately styled unlike the rest of the app — a very dark, restrained "private members'
club" look (`.lab` in `app/globals.css`, its own CSS custom properties alongside the neutral palette
Sports/Picks use and the green-phosphor terminal look Discover uses) instead of another variation
on the same look. One muted silver carries every accent, selection ring, and CTA over soft
translucent glass boxes; home/draw/away get gently desaturated, closely related tones just distinct
enough to tell apart at a glance, rather than a set of competing hues.

The one deliberate exception is the bet slip itself (below) — it keeps its own separate, livelier
violet-and-gold "modern sportsbook" identity (`--slip-*` custom properties, same file), so it reads
as a distinct object sitting on top of the page's calmer silver surface rather than blending into
it. Every other Lab surface — the header, the outcome tiles, placed-bet cards — uses the page's
`--lab-*` variables and follows the dark-silver look.

Every outcome — the main three-way, the two double-chance combos, any Discover
market's outcomes — renders through the same button: a label, a big **decimal odds** number
(`toDecimalOdds`, `lib/format.ts`, e.g. `2.38x`) rather than the percentage-first framing used
everywhere else, with its plain percentage equivalent in small letters right next to it (`toPercent`
of that same probability) for anyone who thinks in implied probability rather than a multiplier —
and the AI's own probability underneath. Edge only ever shows as a small "value"
badge (a bolt icon + the edge) when the AI's read clears the market by 2+ points — deliberately the
*only* place edge appears, and only when it's worth noticing, rather than a number crowding every
single button whether or not it means anything.

Every odds figure and edge shown in Lab is **live**, not the snapshot from when you originally
analyzed the pick — the market moves after that, and showing a stale number would be misleading. A
shared client-side lookup (`lib/livePrices.ts`) re-fetches each outcome's current price by its
Polymarket CLOB token id (the same one behind the odds-history chart's `/api/odds-history`, so no
new API route was needed) and every card, slip leg, and placed bet reads from that one map. A pick
saved before this shipped, or a double-chance combo (no single token prices "1X"), simply has
nothing to reprice and holds at its last known value.

"Current price" reads the **finest** series available — the 3-hour window, bucketed at 5 minutes —
not the 7-day one. This matters more than it sounds: the 7-day series is bucketed at *three hours*,
so its last point (which is what "the price now" means here) could be that far behind. A match
would finish and its odds would sit there still showing the pre-match 70/20 read for the rest of
the afternoon, and because [settlement](#settling-football-bets-against-the-real-result) decides
won/lost from these same numbers, a stale bucket wasn't only cosmetic — it delayed and could
misread a real result. The tradeoff is deliberate: a token with no trades at all in the last few
hours now returns nothing rather than an hours-old number, and each caller falls back to its own
honest stand-in (a leg's entry price; for settlement, no price at all, which simply leaves the bet
open for the real final score to resolve). A stale number that looks live is worse than no number.
Home's portfolio graph is the one place that still asks for the 7-day series, because it is drawing
a 7-day graph — a finer window wouldn't reach back far enough.

- **Build** tab: search across every saved football pick, tap
  an outcome to add it as a leg, or tap the pick's own title/teams to open its full analysis
  report. Every football pick also offers **double chance** — **1X** (home win or draw) and **X2**
  (draw or away win) — as two extra buttons alongside the main three-way ones. Neither is a market
  Polymarket sells separately (a partner-league event is a plain 1X2 with no fourth or fifth
  outcome), so both are computed client-side as the sum of the two 1X2 outcomes they cover
  (`legFromPick` in `lib/betslip.ts`), for both the market's own probability and the AI's
  independent read — edge included, since a combo's edge is just the sum of the two edges it covers.
- A row of five **risk presets** — **Calm, Easy, Normal, Risky, Mega** — each its own tinted "colored
  glass" pill (green through cyan and silver to red, echoing the bet slip's own colored-background
  treatment rather than a plain neutral box) that one-tap builds a slip for you (`lib/riskModes.ts`),
  scanning every saved football pick for its single best qualifying leg
  (never two correlated legs — say, a team's win and its own double-chance — from the same match)
  and replacing whatever's currently in the slip with the result. Calm and Easy only ever bet the
  match's own market favorite among home/draw/away (never a double-chance combo, which is
  definitionally more likely than either outcome it covers and would always look like "the
  favorite" without actually being the market's pick), needing a 10-point or 5-point AI-vs-market
  edge respectively. Normal, Risky, and Mega open the search to all five leg types (home, draw,
  away, 1X, X2) and progressively lower the bar to 5, 3, and 1 point of edge. Whatever qualifies is
  always capped at exactly 3 legs — the highest-edge qualifying games first, whatever kind of bet
  each one is — so a preset never floods the slip with every match that happens to qualify; fewer
  than 3 qualifying games shows "Not enough games for &lt;preset&gt; mode." instead of building anything.
- Adding a leg surfaces a floating pill at the bottom of the screen — how many bets, the combined
  decimal odds, and the combined edge, all live — over a slow, dim gold sheen that drifts across
  the pill (and the expanded sheet behind it) so the slip always feels quietly alive rather than
  static. Tapping it doesn't swap in a separate sheet — the same element morphs in place: its
  border-radius springs from a full pill to a rounded sheet while its body grows open via a
  `grid-template-rows` transition (`0fr` &rarr; `1fr`, `components/BetSlipBar.tsx`), so the whole
  thing reads as one shape stretching open rather than two different elements swapping places.
  Tapping the pill again morphs it back shut the same way. Open, it shows the full slip: every leg with its own live odds/edge, a **stake**
  picker (quick chips of €10/€25/€50/€100), and — with 2+ legs — the combined market and AI
  probability, each the product of every leg's own probability for its chosen outcome
  (`combineSlip`, `lib/betslip.ts`). This math doesn't care what kind of market a leg came from — with Discover
  deactivated the Build tab only ever offers football legs for now, but a parlay placed back when Discover was
  active, freely mixing a football result with, say, a crypto price target, still displays and reprices correctly.
- **Buy**: tapping the gold **Buy €N at Nx** button places the slip as a paper bet at today's
  market price (not whatever it was at analysis time) — a brief "placing" animation, then a
  confetti-and-receipt confirmation, and the slip clears. The stake is spent from the play-money
  balance Home tracks (see below); `lib/placedBets.ts` snapshots the legs, the live entry price,
  and the stake into local storage.
- **My Bets** tab lists every bet you've placed as a ticket-style card — legs, live odds/edge (or
  the real payout and P&amp;L once settled — see
  [Settling football bets against the real result](#settling-football-bets-against-the-real-result)
  below), a status pill (**Pending** / **Won** / **Lost**), and how much you staked on it. Each card
  has its own delete button (`removePlacedBet`, `lib/placedBets.ts`) to clear out a bet you no
  longer want tracked.

## Home: a paper portfolio

**Home** (`app/page.tsx` — the app's default/root route) is a sleek, dark portfolio dashboard: a big
portfolio-value number, an all-time gain/loss line, a value-over-time graph, and your most recent
placed bets with their own live P&L.

- **Balance**: starts at a seeded €1,000 (`STARTING_BALANCE`, `lib/portfolio.ts`) the first time
  you ever open Home, and you can freely **Add funds** afterwards (quick chips or a custom amount)
  — it's play money, so topping up is just for keeping the paper-trading loop going, never a real
  transaction.
- **The graph only moves on price, never on a deposit.** Every deposit you've ever made is simply
  summed into one flat baseline (`totalDeposited`) as if it had all happened before the graph even
  starts — a €500 top-up never appears as a fake spike. The only thing that moves the line above or
  below that baseline is the **mark-to-market value of your open bets**: each leg is repriced by the
  same live-price mechanism Lab uses, using the market's own price-history (`/api/odds-history`) to
  reconstruct what your portfolio would have been worth at each point over the past week
  (`buildPortfolioSeries`, `lib/portfolioHistory.ts`) — the same "buy a share at p0, it's worth p1
  now" math as a real prediction-market position, generalized across every leg in a parlay and
  summed across every bet you've placed. A leg that can't be repriced (no token, or the pick
  predates this feature) just holds at its stake, never fabricating a number.
- **Recent bets** lists your last 5 placed bets — legs, stake, current live value, and P&L in both
  € and % — with a **Show 10** toggle to see more. Nothing here is a real trade; it's the same
  paper-trade philosophy as the rest of the app, just tracked in one place with real numbers instead
  of just probabilities.

### Settling football bets against the real result

A placed bet used to just sit as mark-to-market forever — the app had no way to know how a match
actually finished, so even a bet on a match that ended days ago kept "repricing" instead of ever
becoming a real win or loss. `lib/settlement.ts` fixes this for football legs, trying two sources
in order.

`resolvePendingSettlements` runs once when Home or Lab first loads, and then again every 60
seconds for as long as the tab stays open — it used to run only on that first load, so a match
finishing while the page sat open in the background left its bet stuck showing "Pending" until the
next full reload. The recurring check reads whatever bets exist *at the moment it fires*, via a
ref mirroring state rather than a direct effect dependency, for the same reason the Sports page's
live-score/live-odds polling does: depending on the bets array directly would tear the interval
down and rebuild it every time a bet settled, so it would never actually run on schedule.

The two sources, in order:

1. **The market's own post-match read (primary, fast).** Once the match is over — the app's one
   shared definition of that, [above](#a-matchs-lifecycle-upcoming-live-gone) — a leg is settled by
   reading Polymarket's *current* home/draw/away prices for it (via the same live-price mechanism
   Lab's mark-to-market uses) and taking whichever side is priced highest, however narrow the gap,
   as the winner. This deliberately trusts the market over football-data.org's confirmed score:
   waiting on that provider to report FINISHED (and on the app to happen to be open once it does)
   was what made settlement slow, and a real market's price only has to *lean* toward the actual
   winner once the result is known — it never has to converge to a clean 0/1, so this doesn't get
   stuck waiting for that either.

   This gate used to open earlier, at 2h10m, on its own separate reasoning. That was both a fourth
   copy of "how long is a match" and the least conservative of them, and it carried a real risk: a
   match running long (VAR, injuries, a delayed restart) is priced like whichever side is ahead at
   the time, so reading a winner out of it early could settle a bet the 85th minute's way rather
   than the result's. Nothing shorter than "definitely over" is safe to read a result from.
2. **football-data.org's confirmed score (fallback).** For whatever the market read can't settle
   — thin post-match liquidity, a missing token, an older leg that predates carrying all three
   outcomes' tokens — `getMatchResultsSince` (`lib/footballData.ts`) asks `/api/bets/settlement-scores`
   for the real final score, looking back as far as that league's oldest unsettled bet needs, not
   just "right now". This path matches clubs on both of the provider's names, full and short, for
   the same reason [live scores do](#live-scores-on-the-card): checking only the full name meant a
   bet on Wolves, Spurs, Man City or Inter never found its own match and stayed Pending forever,
   however long ago it finished, while bets on other clubs settled normally. It's also best-effort
   in the same way and for the same reason — it skips rather than queues behind analysis work, and
   the next settlement check (every 60 seconds; see above) tries again.

Whichever source resolves a leg first wins; if neither can, it stays open rather than guessing.
Both compose into the same parlay-level rules:

Both paths need a leg's league/homeTeam/awayTeam (and, for the market path, all three outcome
tokens) to even attempt a lookup — fields added to `SlipLeg` after this app had already been in
real use for a while. Without a backfill, a bet placed before that would carry none of them and
`settlementRefs`/`marketPriceRequests` would silently skip it forever: not "can't settle it yet",
but never even trying — the actual bug behind "the game finished a day ago and it's still Pending".
`backfillLeg` (`lib/settlement.ts`) recovers what it can from fields that have *never* been
optional — `title` ("Home v Away") and `meta` ("🏴 League Name") for the team names and league,
`placedAt` as a safe (if conservative) stand-in kickoff lower bound — so every bet ever placed gets
the same chance to settle as one placed today, with no need to touch data already sitting in a
user's own browser storage.

- A parlay settles **Lost** the instant *any* leg is confirmed lost, whatever the others are doing.
- It only settles **Won** once *every* leg is confirmed won, at `stake / combined market
  probability` (the same decimal-odds math shown everywhere else).
- A leg from a Discover/market pick has no equivalent resolution source and is never guessed at —
  a bet mixing one in can still settle **Lost** if a football leg busts, but can never settle
  **Won** while a market leg remains, so it just stays open forever, same as before this existed.

Once settled, a bet's value is final and frozen from that moment on — `computeBetValue`
(`lib/portfolioHistory.ts`) shows the real payout instead of a live mark-to-market estimate for any
timestamp at or after settlement, while a portfolio-history point from *before* that moment still
shows exactly what the mark-to-market path looked like at the time. `PortfolioBetRow` and
`PlacedBetCard` show a **Won**/**Lost** badge in place of the live odds/edge readout once a bet
resolves either way.

### A parlay's individual legs settle independently, too

The rules above decide the bet AS A WHOLE, but a 3-leg parlay where only one match has finished
doesn't have to wait for the other two before showing what's already known. `computeLegResults`
(`lib/settlement.ts`) runs the exact same per-leg logic and is persisted separately
(`PlacedBet.legResults`, alongside but independent of `settlement`) on every check, even for a bet
that doesn't fully resolve this round — so `PlacedBetCard` colors each leg's own outcome label
green or red the moment ITS match concludes, regardless of what the other legs (or the bet's own
overall badge) are still waiting on. A parlay that ends up **Lost** because one leg busted still
shows its other, individually-winning legs in green — the per-leg color and the bet-level badge
are reporting two different, both-true things, not disagreeing.

### A quick, silly reward for winning

Whenever a bet settles **Won**, `lib/celebration.ts` fires a one-time congratulations overlay. It's
kept completely separate from the app's real analysis pipeline — no user-selected model, no betting
context at all — down to a lightweight OpenRouter call to Gemini (`lib/clubVibe.ts`), shaped
differently depending on whether it's a single bet or a parlay:

- **Single-leg win** — one club to celebrate, so the call (`getClubVibe`) asks for exactly 5 emojis
  and 2 hex colors matching that club's vibe (a plain double-chance win collapses to the one real
  side it locks in: 1X → the home club, X2 → the away club; a bare draw win has no club at all, so
  it's skipped). All 5 emojis fall in the rain animation, and both colors become the background.
- **Parlay win** — a parlay can only ever settle Won once **every** leg has won, so every leg's own
  team gets to celebrate. One call (`getClubVibes`) asks for one emoji + one color per team, matched
  back to the caller's own team list purely by position (a draw leg is skipped, same as above). Every
  team's emoji falls in the rain, and the background gradient is 2 colors picked **at random** from
  the full set the teams returned (`pickTwoRandom`) — a different pair, in a different order, each
  time.

`WinCelebration.tsx` renders whichever shape it's given — a single "Congratulations! X came through"
line for one team, or a per-team list (each team's name in its own color) captioned "Every leg came
through" for a parlay — as a full-screen falling-emoji animation over a panel styled to match the Lab
bet slip's own violet "modern sportsbook" look (the same `--slip-*` tokens `BetSlipBar.tsx` uses,
re-established via a wrapping `.lab` class so they resolve correctly even when triggered from Home,
which isn't normally inside that scope). Fires at most once per bet — `resolvePendingSettlements`
only ever reports a bet in its `newlyWon` list the one time it transitions from unsettled to Won,
never again on a later reload — and a failed/empty vibe fetch just means no celebration shows, never
an error over what should be a purely happy moment.

## Odds history

Every card — a Discover market or a Sports match — has a collapsed **Odds history** dropdown that
expands into a small line chart of how its outcomes' prices moved over the past week, one line per
outcome (home/draw/away for football; the market's top few outcomes, capped at 4, for Discover),
in the same colors used everywhere else on that card so the chart reads as an extension of it
rather than a new visual language. Dragging or tapping along the chart shows a crosshair with the
exact value of every line at that point in time. The dropdown only appears when Polymarket actually
gave us a price-history token for at least one outcome — some thin or brand-new markets don't have
one yet, and there's nothing to chart in that case.

A row of three small **7D / 1D / 3H** buttons under the chart switches how much history is shown
— and each one fetches its own CLOB interval/fidelity rather than just re-slicing the same 7-day
series, so 3H is genuinely higher resolution than 1D, which is higher resolution than 7D, not the
same coarse buckets zoomed in (`WINDOW_CONFIG` in `lib/oddsHistoryServer.ts`: `1w`/3-hour buckets,
`1d`/30-minute buckets, and `6h`/5-minute buckets trimmed down to the labeled 3h client-side, since
CLOB has no exact "3h" interval of its own). Only the `1w` combination has actually been confirmed
against the real API (from before these buttons existed); `1d` and `6h` are CLOB's documented
shorter intervals but haven't been confirmed the same way — if either turns out wrong, a button
just falls back to the same "not enough trading history" message a thin/brand-new market already
gets, never a crash. Each window's data is fetched once per card and cached for the rest of that
card's session, so switching between already-visited windows is instant.

This is backed by Polymarket's own CLOB order-book API
(`clob.polymarket.com/prices-history`), proxied through `/api/odds-history`
(`lib/oddsHistoryServer.ts`) so the real endpoint and any caching stay server-side — the browser
never talks to Polymarket directly for this. The token id each outcome needs for that lookup
(`clobTokenIds`, distinct from the market's own id) is threaded through from Gamma's event data
during parsing (`lib/polymarket.ts`, `lib/allMarkets.ts`) alongside the price itself; an outcome
Gamma didn't give a token for simply doesn't get a line. In local mock mode (`MOCK_GAMES=1` /
`MOCK_MARKETS=1`) the route synthesizes a deterministic pseudo-random trend that lands exactly on
the mock price you're already seeing (`lib/mockOddsHistory.ts`), so the chart is testable without
hitting Polymarket at all.

## How the AI analysis works

Tapping **AI Analyze** runs against [`deepseek/deepseek-v4-flash-0731`](https://openrouter.ai/deepseek/deepseek-v4-flash-0731)
(or whichever model is selected) via OpenRouter, but the first step differs between football (Sports) and Discover markets.

**Football** (`lib/footballData.ts`, `lib/openrouter.ts`):

1. **Research** — *not* a web search. An AI web-search pass here used to give wrong data (stale injuries, mixed-up form,
   invented head-to-head records) often enough to be worse than useless, so this step is now a plain data fetch against
   two structured providers, no LLM involved at all. [football-data.org](https://www.football-data.org/) supplies the
   core match data — each club's last 5 completed results, the last 5 head-to-head meetings, and the fixture's own live
   status (whether it's started yet, and if so the current score, straight from its own kickoff time rather than assuming
   Polymarket's original schedule still holds). There's no fallback to web search if a team or fixture can't be matched
   there — the analysis fails with a clear error rather than quietly falling back to a shakier source. (This app first
   tried [API-Football](https://www.api-football.com/) instead — its free plan looked equivalent on paper, but locks every
   endpoint to old completed seasons in practice, making it useless for a current match. football-data.org's free tier has
   no such season lock, covering 7 of the 8 domestic leagues below plus the Champions League — everything except Belgian
   Pro League, which has no free-tier code.) [Big Balls Sports Data](https://bigballsdata.com/) supplies the
   injuries/availability section football-data.org can't (it has no injuries endpoint at any tier): Premier League, La
   Liga, Bundesliga, Serie A, Ligue 1, and the Champions League — not Primeira Liga, Eredivisie, or Belgian Pro League.
   This one is an enrichment layer rather than a core source: an unset key, an uncovered league, or a failed request all
   just make the digest say injury data isn't available for that match, rather than failing the whole analysis the way a
   football-data.org miss does — that data was never guaranteed before, so its absence is a known, honest gap, not a
   regression.
2. **Independent read** — an OpenRouter call, no web access, that only ever sees that digest and produces the 1X2 probability
   estimate from it, structured as each team's case (a short pros list and cons list, `homeAssessment`/`awayAssessment` in
   `IndependentPrediction`) plus one overall `summary` — shown as two per-team cards (`components/TeamAssessmentSummary.tsx`,
   shared between the live analysis sheet and a saved pick's read-only detail view) rather than a single flat bullet list,
   so it's clear which point is about which team. Running research more than once merges pros/cons per team across runs
   the same way it already deduped a flat list (`lib/aggregate.ts`), and the market-comparison step below is shown each
   team's merged pros/cons alongside the summary for full context, not just the summary alone.
3. **Market comparison** — the app reveals Polymarket's implied probabilities for the same match and asks the model to
   compare its independent view against the market, explain any disagreement, and flag whether it thinks a specific outcome
   looks mispriced.

Alongside the AI's own read, the same one-time digest fetch (`/api/analyze/football-digest`) also returns two small,
factual infograms — real data, not an AI opinion, so they render even before the independent read finishes:

- **League standing** (`components/TeamStandingsSummary.tsx`) — each team's current table position, points, games played,
  goals for/against, and a compact 5-match form strip (oldest → most recent), from football-data.org's standings endpoint
  combined with the same recent-results fetch the text digest already uses for form (`TeamStanding` in `lib/types.ts`,
  built in `fetchFootballDigest`). An enrichment, not a core fact: a standings-endpoint failure or a team missing from the
  table just means that side shows "not available" rather than failing the whole analysis.
- **Injuries / out** (`components/TeamInjuriesSummary.tsx`) — each team's currently-unavailable players from Big Balls
  Sports Data, with whatever reason the source actually gave (it mostly only flags a bare "unavailable" with no reason at
  all, so the fallback says exactly that rather than implying more was checked — see `lib/bigBallsData.ts`). Built by
  `fetchInjurySummary`, a structured counterpart to the text digest's own injuries section that reads the same cached
  fetchers rather than costing a second real request. Renders nothing at all (not two empty "None reported" lists) when
  the league isn't covered, there's no key, or team-name resolution fails — an empty state there would misleadingly imply
  data was checked and found clean.

Both are attached to a `SavedPick` (`homeStanding`/`awayStanding`/`homeInjuries`/`awayInjuries`) so a saved pick's
read-only detail view (`PickDetailSheet.tsx`) shows the exact same infograms later, not just the live analysis sheet.
Batch analysis doesn't fetch either (its condensed cards already omit the pros/cons/summary breakdown too), and a pick
saved before this existed just doesn't have the fields at all — both components render nothing rather than guessing.

**Discover markets** (`lib/openrouterMarkets.ts`) — any non-football question, where no equivalent structured API exists —
keep the original three-step shape:

1. **Research** — a call with web access (OpenRouter's `:online` plugin) that does nothing but research the question and
   organize what it finds into a plain-text digest: recent news, relevant data, expert analysis, and historical base rates.
   This step's system prompt explicitly forbids it from ever mentioning betting odds, bookmaker lines, or prediction-market
   prices anywhere in that digest — if a source it reads mentions a price, it's instructed to silently omit that part and
   keep only the underlying facts.
2. **Independent read** — a *separate* call, with no web access of its own, that only ever sees the digest from step 1 (never
   the raw web) and produces a probability estimate for every listed outcome from it.
3. **Market comparison** — same idea as football's: reveal the market's implied probabilities and ask for a comparison.

Every one of these calls — system prompt and user prompt alike, every step, football and Discover markets both — also
carries the real current date and time (`nowLine`/`withNow` in `lib/openrouter.ts`, computed fresh on every call rather than
baked into a prompt string built once at server start). A model has no reliable sense of "today" from its training data
alone, and Discover's research step is told to weigh the most recent news far more heavily than older context, trusting
whichever source is more recent when two disagree — the whole point of giving it live web access is to catch what's
actually current, not to average it in with stale context. Every system prompt also ends with a short "Soul" line setting
the model's persona for the read it's about to give: *"You are wise, you are advanced, you are super intelligent and smart,
you are logical and certain, you are bold, you go for it, you trust your decision."*

All results are shown in the UI as a guided reveal, and the whole thing can be saved to **My Picks**.
Saving is keyed by the match/market's own id (`lib/picks.ts`, `lib/marketPicks.ts`), so re-analyzing
and re-saving the same game or market replaces its previous save rather than adding a duplicate —
My Picks always holds your latest read on a given match or market, never several stale ones side by side.

**Why Discover still splits research and judgment into two calls:** OpenRouter's `:online` step isn't an isolated browsing
session — it's a single search pass that runs before the model answers, and whatever it finds is merged straight into the
same context the model then writes its estimate from. A single model doing both "search the web" and "form an opinion" in
one call could plausibly see the real odds mid-search (a betting aggregator, a news piece citing the market price, or the
very Polymarket market being asked about) and have them sitting right there in context while it writes a number it's
supposed to have reached independently. Splitting research and judgment into two separate calls means the step that forms
the actual estimate has no web access at all — it can only ever see what the research step chose to hand it, and that
step's entire job is a summary with the odds already stripped out. It's still not a mathematical guarantee (the digest step
could in principle slip up), so both steps carry an explicit "never mention/disregard odds" instruction as defense in
depth, but it's a meaningfully stronger boundary than trusting one model to browse and then talk itself out of what it just
saw. Football sidesteps this problem a different way: there's no web search in its pipeline to anchor on in the first
place.

### Running research more than once

Next to each card's **Analyze** button is a small stepper (1&times;-5&times;) for how many times to
run the independent-research step before comparing to the market (`lib/researchRuns.ts`, one
global preference like the model choice). At 1&times; nothing changes. Above that, the app fires
that many independent, from-scratch research passes all at once (they don't depend on each other,
so there's no reason to wait for one before starting the next) and waits for every one to land,
then averages them (`lib/aggregate.ts`) into the single read that gets compared against the market
— the result shows each run's own numbers plus how much they agreed with each other (a plain-
language agreement label plus the per-run breakdown), so you can tell a stable read from one that's
basically a coin flip. That merged, multi-run read is what gets saved with the pick.

For football specifically, since research is no longer an LLM call, running it more than once means
several independent-read passes over the *same* football-data.org digest rather than several fresh
searches — still meaningfully different runs, since the predict step's own sampling varies each
time, but the diversity comes entirely from that step now rather than from re-researching too.
Those N runs are N separate HTTP requests to `/api/analyze/predict`, and Vercel can (and does) route
concurrent requests to separate serverless instances that don't share any in-process state — a
server-side cache or in-flight-request coalescing inside `lib/footballData.ts` only helps when calls
land on the *same* warm instance, so relying on that alone let N parallel runs multiply real
football-data.org calls by N under real concurrent load, exhausting the free tier's
10-requests/minute budget almost immediately. The actual fix is architectural, not caching:
`components/AnalysisSheet.tsx` fetches the digest exactly once via a dedicated
`/api/analyze/football-digest` call, then fires all N predict calls with that same digest text
already attached — so N runs cost exactly one round of football-data.org calls by construction,
regardless of how Vercel happens to distribute those N requests across instances. (Batch analysis
and a single run don't have this redundancy risk in the first place — they still fetch the digest
inline via the same `getIndependentPrediction` convenience path as before.) On top of that, every
call to football-data.org still goes through an in-process sliding-window throttle (10 requests per
rolling 60 seconds) and reads football-data.org's own "Wait N seconds" message for a single informed
retry if a 429 does slip through — both useful defense-in-depth for other traffic (a single-run
analysis, batch analysis of several different matches, the live-scores/live-odds polling below), but
neither was ever going to fix the N-runs-per-match case on its own.

The "researching" screen itself is a small centered popup — not the full-width sheet used once
results are in, and with no way to dismiss it mid-analysis — with a pulsing radar animation rather
than a checklist (`components/ResearchOverlay.tsx`), and a run-progress indicator ("2 of 3 runs
done") when more than one pass is in flight.

### Every card remembers its last analysis

Analyzing a match or market caches the result against that match/market's id
(`lib/lastAnalysis.ts` for Sports, `lib/lastMarketAnalysis.ts` for Discover) the moment it
finishes — whether or not you ever tap **Save**. The card shows a one-line summary ("AI: Arsenal
52% &middot; +4pp edge &middot; 2h ago") with a dropdown that expands into the full read: AI vs.
market for every outcome, confidence, the verdict, and the multi-run agreement breakdown if it was
researched more than once. Re-analyzing overwrites the cached entry; each cache is capped at the
150 most recently analyzed matches/markets to keep it from growing unbounded. For Sports
specifically, this summary stops showing on a card the moment that match's kickoff passes — see
[Stale analysis disappears at kickoff](#stale-analysis-disappears-at-kickoff).

### Cost tracking

Every analysis shows what it actually cost. OpenRouter's usage-accounting opt-in
(`usage: { include: true }` on every request, `lib/openrouter.ts`) returns a real dollar figure per
call, and since the research and predict calls are two separate API calls, the app sums their costs
rather than reporting just one side. A wasted attempt still costs money too — if a call comes back
empty or truncated and gets retried, that attempt's cost is added to the total rather than
discarded, so the number reflects everything OpenRouter actually billed for that analysis, not just
the call that finally succeeded. Running research more than once sums across all runs, since each
one is its own independent research+predict pair (`lib/aggregate.ts`) — unlike the probability
estimates, cost is never averaged.

The figure appears everywhere an analysis does: in the results sheet once comparison finishes, on
the card's cached last-analysis summary, and on a saved pick's detail view. It's formatted with
however many decimals actually show something (`formatCostUsd`, `lib/format.ts`) — analyses
typically cost a fraction of a cent, so a flat two-decimal format would round almost everything to
"$0.00". A provider that doesn't report cost (or local mock-data mode) simply shows nothing rather
than a placeholder.

### Choosing a model

The model button in the header (Discover and Sports both show it — it's one global choice, since
both feeds run through the same analysis pipeline) lets you pick which model powers every
analysis: [`deepseek/deepseek-v4-flash-0731`](https://openrouter.ai/deepseek/deepseek-v4-flash-0731)
(the default), [`z-ai/glm-5.3-flash`](https://openrouter.ai/z-ai/glm-5.3-flash),
[`google/gemini-3.8-flash`](https://openrouter.ai/google/gemini-3.8-flash), or
[`nvidia/nemotron-3-ultra-550b-a55b`](https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b). The
choice is remembered in your browser (`lib/models.ts`) and sent with every predict/compare request;
the API routes resolve it against a small server-side whitelist, so nothing free-text ever reaches
OpenRouter as a model id.

Every OpenRouter request asks for the lightest reasoning effort OpenRouter allows
(`reasoning: { effort: "low" }` in `lib/openrouter.ts`). Reasoning-capable releases — DeepSeek's in
particular — default to a "high" reasoning effort, silently burning a large hidden chain-of-thought
token budget before the model ever writes the prose or JSON we actually asked for; that's most of
why an analysis could feel like it hangs, and it made the length-triggered retry (see above) fail
the same way on every attempt since the budget kept going to reasoning instead of the answer. This
is a request, not a hard disable, on purpose: some providers mandate reasoning for their endpoint
and reject an outright `enabled: false` with a 400 ("Reasoning is mandatory ... cannot be
disabled"), which briefly broke every model except DeepSeek before this was caught. `callOpenRouter`
also carries a one-shot fallback for that exact error — it retries once with no `reasoning` field
at all — so one provider's quirk can't take the whole roster down again.

Tap the select icon in the header to pick up to 10 matches and analyze them all in one batch —
they run through the same two-step process sequentially (not in parallel, to stay well within
OpenRouter's rate limits) and each result appears in the sheet as it finishes.

## Filtering and refreshing

- **Leagues** — pick any combination of leagues from the filter row; tapping a league toggles it,
  and **All** clears the selection. Your choice is remembered across visits.
- **Top Games** — narrows to matches where at least one side is on the curated elite-club list in
  `lib/topTeams.ts`. Combines with the league selection.
- **Club crests** — every team currently shown anywhere in the app (games, saved picks, slip legs),
  not just the Top Games list, gets its crest looked up from [TheSportsDB](https://www.thesportsdb.com/)
  (`lib/clubLogos.ts`, `/api/logos`). Resolved names are cached in `localStorage` indefinitely (crests
  essentially never change), so a club is only ever looked up once across the app's lifetime; any club
  with no crest, or whose image fails to load, falls back to its initials.
- **Caching** — fetched markets are cached in `localStorage`, so reopening the app renders instantly
  with no network request. They refresh automatically every 30 minutes, when you return to a tab
  that's gone stale, and whenever you tap the refresh button in the header. If a refresh fails, the
  last known odds stay on screen with a notice rather than being replaced by an error.

## Bottom navigation

The bottom nav (`components/BottomNav.tsx`) is a floating rounded bar inset from both screen
edges, not a full-width strip flush against them. Behind it — on every page, since both live in
the root layout — sits `BottomFade`, a screen-wide gradient that's fully transparent at the nav's
own top edge and fades to 95% opaque black by the bottom of the screen, so ordinary content
scrolling underneath darkens progressively as it nears the nav rather than cutting off abruptly.
The nav is the only thing rendered above that gradient; the fade's height is kept in exact sync
with the nav's own rendered height (which varies by device, mainly the safe-area inset) via a
`--bottom-nav-height` CSS custom property BottomNav publishes from a `ResizeObserver` on itself,
rather than duplicating its padding math in a second place.

## Install as an app

BetIntelligence is a PWA: **Add to Home Screen** on iOS or **Install** on Android/desktop and it
runs standalone with its own icon, no browser chrome, and an app shell that still opens offline
(cached by `public/sw.js` — API responses are never cached, since a stale price is a wrong price).
Icons are generated by `npm run icons` from `scripts/generate-icons.ts`.

## Easter egg

Every 10-30 seconds, on any page, a small winged coin flies across the screen
(`components/FlyingMoney.tsx`). Tap it before it flies off and it pays out a token reward between
€0.0001 and €0.01 (`lib/luckyMoney.ts`) — miss it and it just flies away, and a new one gets
scheduled at another random delay. Purely for fun: there's no wallet, no balance, and nothing is
persisted — the reward is just a celebratory popup that fades after a couple seconds.

## Getting started

```bash
npm install
cp .env.example .env.local
# add your OpenRouter API key to .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Yes (for real analysis) | API key from [openrouter.ai/keys](https://openrouter.ai/keys). |
| `FOOTBALL_DATA_API_KEY` | Yes (for football analysis) | Free key from [football-data.org](https://www.football-data.org/client/register). Powers football's core research step (form, head-to-head, fixture status/score); Discover markets don't use it. |
| `BIG_BALLS_API_KEY` | No | Free key from [bigballsdata.com](https://bigballsdata.com/). Adds the injuries/availability section to football's research step. Left unset, that section just says injury data isn't available. |
| `NEXT_PUBLIC_APP_URL` | No | Sent to OpenRouter as the app's referer/title for their dashboards. |
| `MOCK_GAMES` | No | Set to `1` to serve built-in sample matches instead of calling Polymarket. Useful for local UI work without network access. |
| `MOCK_MARKETS` | No | Set to `1` to serve built-in sample Discover markets instead of calling Polymarket. |
| `MOCK_AI` | No | Set to `1` to return a canned analysis instead of calling OpenRouter (covers both Sports and Discover's analysis flows). Useful for testing without spending API credits. |

No API key or account is needed to browse games — Polymarket's Gamma API is public. A key is only
required to run AI analysis.

## Data sources

- **Odds**: [Polymarket's Gamma API](https://docs.polymarket.com/) (`gamma-api.polymarket.com`), no
  auth required.
  - `lib/polymarket.ts` (Sports) fetches upcoming soccer events, matches them against a keyword
    list for the Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Primeira Liga, Eredivisie,
    Belgian Pro League, and the Champions League, and derives 1X2 probabilities from each match's
    three moneyline sub-markets. The same module's `fetchLiveOdds` refreshes odds for currently-live
    games every 5 seconds — see [Live odds once a match kicks off](#live-odds-once-a-match-kicks-off).
  - `lib/allMarkets.ts` (Discover) sweeps the highest-volume active events across every category,
    with no fixed category list — categories shown are derived from whatever tags Polymarket
    actually returns on the fetched markets.
- **Analysis**: [OpenRouter](https://openrouter.ai/) chat completions — `lib/openrouter.ts` for
  Sports' football-specific prompts, `lib/openrouterMarkets.ts` for Discover's generalized
  any-market prompts (both share the same request/retry/JSON-parsing core in `lib/openrouter.ts`).
- **Football match data**: [football-data.org](https://www.football-data.org/) (`api.football-data.org/v4`)
  — `lib/footballData.ts` fetches each team's recent form, head-to-head history, and the fixture's
  own live status/score, and feeds that straight into the football research digest above. The same
  provider also powers the games list's live-score badge (`getLiveScores`, one request per covered
  league rather than per match) — see [Live scores on the card](#live-scores-on-the-card). No
  fallback to web search on a miss.
- **Football injuries/availability**: [Big Balls Sports Data](https://bigballsdata.com/)
  (`api.bigballsdata.com/v1`) — `lib/bigBallsData.ts` fetches each covered league's current injury
  list plus a team-id-to-name lookup (a player record carries only an opaque team id, no name —
  confirmed against a real response via `/api/debug/injuries`, not guessed), resolves the two
  teams in the match, and appends an "Injuries / Availability" section to the digest above. Covers
  Premier League, La Liga, Bundesliga, Serie A, Ligue 1, and the Champions League; an uncovered
  league, an unset `BIG_BALLS_API_KEY`, or a failed request all render as an honest "not available"
  line rather than failing the analysis — this source is an enrichment layer, not a required one.
  If the team-name lookup itself fails, the digest still surfaces the full unmatched player list
  league-wide rather than silently claiming neither team has any reported injuries. Every failure
  mode is logged via `console.error`, and `/api/debug/injuries?league=<id>` (not linked from the
  UI) returns the raw responses for both endpoints directly — useful if this ever looks wrong again
  once deployed, since this provider's exact contract can't be tested live from this project's dev
  environment (its domain is blocked by that sandbox's network policy the same way
  football-data.org's docs were).

## Project structure

```
app/
  page.tsx                            Home (default route) — portfolio balance, value graph, recent bets
  discover/page.tsx                   Deactivated for now — redirects to Home, see "Discover" above
  sports/page.tsx                     Sports — the original football-only game list
  picks/page.tsx                      Every saved football analysis, sorted by when you saved it
  lab/page.tsx                        Build a single/multi football bet from any saved pick and buy it
  api/markets/route.ts                Fetches + normalizes Discover's trending markets
  api/analyze/market/predict/route.ts Discover step 1: independent AI prediction (any market)
  api/analyze/market/compare/route.ts Discover step 2: compare prediction against market odds
  api/games/route.ts                  Fetches + normalizes Sports' Polymarket games
  api/analyze/predict/route.ts        Sports step 1: independent AI prediction
  api/analyze/compare/route.ts        Sports step 2: compare prediction against market odds
  api/odds-history/route.ts           Proxies Polymarket's CLOB price-history, per outcome token
components/                           UI components (game/market cards, analysis sheets, etc.)
lib/                                  Polymarket + OpenRouter integrations, types, formatting, storage
```

## Tech

Next.js (App Router) + TypeScript + Tailwind CSS v4. No database — game data is fetched fresh on
each request, and saved picks live in the browser's `localStorage`.

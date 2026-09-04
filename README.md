# BetIntelligence

AI odds-intelligence for Polymarket prediction markets. **Home** (`/`, the app's default tab) is
your paper-trading portfolio — see below. **Discover** covers *everything else* on Polymarket —
politics, crypto, business, entertainment, science, sports, anything — and lets an LLM
independently research and form its own probability read on a market before it ever sees
Polymarket's price, then compares the two to flag markets that might be mispriced. **Sports** is
the original, more specialized version of the same idea: upcoming 1X2 matches from Polymarket's
top 8 European football leagues, with the same blind-then-compare flow.

This is a paper-trading / research tool: there is no real-money betting. "Saving a pick" just
stores your AI's read in your browser's local storage, and **Home**'s portfolio balance is play
money you can top up freely — see below.

## Discover

The **Discover** tab (`app/discover/page.tsx`) is a trending feed of Polymarket's highest-volume markets
across every category, refreshed from a live sweep of Polymarket's Gamma API (`lib/allMarkets.ts`)
— no fixed list of categories or leagues, whatever is actually trending shows up. Tap a category
chip to filter, or **Analyze** any card to run the same independent-research-then-compare flow
described below, generalized for markets with anywhere from 2 (Yes/No) to a dozen-plus named
outcomes (`lib/openrouterMarkets.ts`, `/api/analyze/market/predict`, `/api/analyze/market/compare`).
A saved analysis lands in `lib/marketPicks.ts` — a separate store from Sports' picks
(`lib/picks.ts`), so the two flows can never corrupt each other's data — but both are shown
together everywhere a pick is shown: **Picks** and **Lab**.

## Sports

The **Sports** tab (`app/sports/page.tsx`) is the original football-only experience — see below
for how its AI analysis, filtering, and caching work.

## Picks and Lab: one shared view across both

Every analysis you save, whether it came from Discover or Sports, shows up together:

- **Picks** lists every saved analysis — football and any other market — sorted by when you saved
  it, each rendered with its own card style but in one merged, chronological feed. An **All /
  Football** filter narrows the feed to just football picks; tapping any card reopens its full
  analysis report (independent read, key factors, sources, market comparison, verdict — everything
  shown live while it was analyzing, plus the multi-run breakdown if it was researched more than
  once) in a read-only detail sheet (`components/PickDetailSheet.tsx` /
  `components/MarketPickDetailSheet.tsx`).
- **Lab** (formerly "Slip") builds a single or multi-leg (parlay) bet from any combination of your
  saved picks, football and Discover markets alike, then lets you place it as a paper bet — see
  below for how it looks and works.

### Lab: a sportsbook-style slip

Lab is deliberately styled unlike the rest of the app — a deep violet "modern sportsbook" theme
(`.lab` in `app/globals.css`, its own CSS custom properties alongside the neutral palette
Sports/Picks use and the green-phosphor terminal look Discover uses) instead of another variation
on the same look. One muted gold carries every accent, selection ring, and CTA; home/draw/away get
gently desaturated, closely related tones just distinct enough to tell apart at a glance, rather
than a set of competing neon hues. Every outcome — the main three-way, the two double-chance combos, any Discover
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

- **Build** tab: search across every saved pick (with the same All/Football filter as Picks), tap
  an outcome to add it as a leg, or tap the pick's own title/teams to open its full analysis
  report. Every football pick also offers **double chance** — **1X** (home win or draw) and **X2**
  (draw or away win) — as two extra buttons alongside the main three-way ones. Neither is a market
  Polymarket sells separately (a partner-league event is a plain 1X2 with no fourth or fifth
  outcome), so both are computed client-side as the sum of the two 1X2 outcomes they cover
  (`legFromPick` in `lib/betslip.ts`), for both the market's own probability and the AI's
  independent read — edge included, since a combo's edge is just the sum of the two edges it covers.
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
  (`combineSlip`, `lib/betslip.ts`). This math doesn't care what kind of market a leg came from, so a parlay can
  freely mix a football result with, say, a crypto price target.
- **Buy**: tapping the gold **Buy €N at Nx** button places the slip as a paper bet at today's
  market price (not whatever it was at analysis time) — a brief "placing" animation, then a
  confetti-and-receipt confirmation, and the slip clears. The stake is spent from the play-money
  balance Home tracks (see below); `lib/placedBets.ts` snapshots the legs, the live entry price,
  and the stake into local storage.
- **My Bets** tab lists every bet you've placed as a ticket-style card — legs, live odds/edge, and a
  **Pending** status, honestly reflecting that this is a record of what you bought, not a settled
  result — the app has no way to know how a match or market
  actually resolved.

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

## Odds history

Every card — a Discover market or a Sports match — has a collapsed **Odds history** dropdown that
expands into a small line chart of how its outcomes' prices moved over the past week, one line per
outcome (home/draw/away for football; the market's top few outcomes, capped at 4, for Discover),
in the same colors used everywhere else on that card so the chart reads as an extension of it
rather than a new visual language. Dragging or tapping along the chart shows a crosshair with the
exact value of every line at that point in time. The dropdown only appears when Polymarket actually
gave us a price-history token for at least one outcome — some thin or brand-new markets don't have
one yet, and there's nothing to chart in that case.

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

Tapping **AI Analyze** on a match runs a three-step process against
[`deepseek/deepseek-v4-flash-0731`](https://openrouter.ai/deepseek/deepseek-v4-flash-0731) (or whichever model is selected)
via OpenRouter:

1. **Research** — a call with web access (OpenRouter's `:online` plugin) that does nothing but research the match and
   organize what it finds into a plain-text digest: form, injuries/suspensions, key players, head-to-head history, and other
   context. This step's system prompt explicitly forbids it from ever mentioning betting odds, bookmaker lines, or
   prediction-market prices anywhere in that digest — if a source it reads mentions a price, it's instructed to silently
   omit that part and keep only the underlying facts.
2. **Independent read** — a *separate* call, with no web access of its own, that only ever sees the digest from step 1 (never
   the raw web) and produces the 1X2 probability estimate from it.
3. **Market comparison** — the app then reveals Polymarket's implied probabilities for the same match and asks the model to
   compare its independent view against the market, explain any disagreement, and flag whether it thinks a specific outcome
   looks mispriced.

All three results are shown in the UI as a guided reveal, and the whole thing can be saved to **My Picks**.
Saving is keyed by the match/market's own id (`lib/picks.ts`, `lib/marketPicks.ts`), so re-analyzing
and re-saving the same game or market replaces its previous save rather than adding a duplicate —
My Picks always holds your latest read on a given match or market, never several stale ones side by side.

**Why two calls instead of one for the "independent" read:** OpenRouter's `:online` step isn't an isolated browsing session —
it's a single search pass that runs before the model answers, and whatever it finds is merged straight into the same context
the model then writes its estimate from. A single model doing both "search the web" and "form an opinion" in one call could
plausibly see the real odds mid-search (a betting aggregator, a news piece citing the market price, or, for Discover, the
very Polymarket market being asked about) and have them sitting right there in context while it writes a number it's
supposed to have reached independently. Splitting research and judgment into two separate calls (`lib/openrouter.ts`,
`lib/openrouterMarkets.ts`) means the step that forms the actual estimate has no web access at all — it can only ever see
what the research step chose to hand it, and that step's entire job is a summary with the odds already stripped out. It's
still not a mathematical guarantee (the digest step could in principle slip up), so both steps carry an explicit
"never mention/disregard odds" instruction as defense in depth, but it's a meaningfully stronger boundary than trusting one
model to browse and then talk itself out of what it just saw.

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
150 most recently analyzed matches/markets to keep it from growing unbounded.

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

Every OpenRouter request explicitly disables reasoning (`reasoning: { enabled: false }` in
`lib/openrouter.ts`). Reasoning-capable releases — DeepSeek's in particular — default to a "high"
reasoning effort on OpenRouter, which silently burns a large hidden chain-of-thought token budget
before the model ever writes the prose or JSON we actually asked for. Left on, that's most of why
an analysis could feel like it hangs, and it made the length-triggered retry (see above) fail the
same way on every attempt since the budget kept going to reasoning instead of the answer. None of
our prompts want visible reasoning, so it's off everywhere.

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
    and Belgian Pro League, and derives 1X2 probabilities from each match's three moneyline
    sub-markets.
  - `lib/allMarkets.ts` (Discover) sweeps the highest-volume active events across every category,
    with no fixed category list — categories shown are derived from whatever tags Polymarket
    actually returns on the fetched markets.
- **Analysis**: [OpenRouter](https://openrouter.ai/) chat completions — `lib/openrouter.ts` for
  Sports' football-specific prompts, `lib/openrouterMarkets.ts` for Discover's generalized
  any-market prompts (both share the same request/retry/JSON-parsing core in `lib/openrouter.ts`).

## Project structure

```
app/
  page.tsx                            Home (default route) — portfolio balance, value graph, recent bets
  discover/page.tsx                   Discover — trending markets across all of Polymarket
  sports/page.tsx                     Sports — the original football-only game list
  picks/page.tsx                      Every saved analysis, football and Discover, merged
  lab/page.tsx                        Build a single/multi bet from any saved pick and buy it
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

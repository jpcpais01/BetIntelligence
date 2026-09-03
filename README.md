# BetIntelligence

AI odds-intelligence for Polymarket prediction markets. **Discover** (the home tab) covers
*everything* on Polymarket — politics, crypto, business, entertainment, science, sports, anything
— and lets an LLM independently research and form its own probability read on a market before it
ever sees Polymarket's price, then compares the two to flag markets that might be mispriced.
**Sports** is the original, more specialized version of the same idea: upcoming 1X2 matches from
Polymarket's top 8 European football leagues plus Brazil's Brasileirao, with the same blind-then-
compare flow.

This is a paper-trading / research tool: there is no real-money betting or wallet integration.
"Saving a pick" just stores your AI's read in your browser's local storage.

## Discover

The **Discover** tab (`app/page.tsx`) is a trending feed of Polymarket's highest-volume markets
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
  it, each rendered with its own card style but in one merged, chronological feed.
- **Lab** (formerly "Slip") builds a single or multi-leg (parlay) bet from any combination of your
  saved picks, football and Discover markets alike: search across all of them, tap an outcome on
  each to add it as a leg. In **Multi** mode with 2+ legs, the combined market probability and
  combined AI probability are each the product of every leg's own probability for its chosen
  outcome (`lib/betslip.ts`) — the gap between the two is how much more, or less, likely the AI
  thinks the whole parlay is than the market's pricing implies. This math doesn't care what kind
  of market a leg came from, so a parlay can freely mix a football result with, say, a crypto
  price target.

## How the AI analysis works

Tapping **AI Analyze** on a match runs a two-step process against
[`deepseek/deepseek-v4-flash-0731`](https://openrouter.ai/deepseek/deepseek-v4-flash-0731) via OpenRouter:

1. **Independent read** — the model is given only the two teams, the league, and kickoff time. It
   searches the web (via OpenRouter's `:online` web plugin) for current form, injuries/suspensions,
   key players, head-to-head history, and other context, then produces its own 1X2 probability
   estimate. At this point it has not seen Polymarket's odds.
2. **Market comparison** — the app then reveals Polymarket's implied probabilities for the same
   match and asks the model to compare its independent view against the market, explain any
   disagreement, and flag whether it thinks a specific outcome looks mispriced.

Both results are shown in the UI as a guided reveal, and the whole thing can be saved to **My Picks**.

### Choosing a model

The **DeepSeek/GLM** button in the header (Discover and Sports both show it — it's one global
choice, since both feeds run through the same analysis pipeline) lets you pick which model powers
every analysis: [`deepseek/deepseek-v4-flash-0731`](https://openrouter.ai/deepseek/deepseek-v4-flash-0731)
(the default) or [`z-ai/glm-5.3-flash`](https://openrouter.ai/z-ai/glm-5.3-flash). The choice is
remembered in your browser (`lib/models.ts`) and sent with every predict/compare request; the API
routes resolve it against a small server-side whitelist, so nothing free-text ever reaches
OpenRouter as a model id.

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
    Belgian Pro League, and Brasileirao, and derives 1X2 probabilities from each match's three
    moneyline sub-markets.
  - `lib/allMarkets.ts` (Discover) sweeps the highest-volume active events across every category,
    with no fixed category list — categories shown are derived from whatever tags Polymarket
    actually returns on the fetched markets.
- **Analysis**: [OpenRouter](https://openrouter.ai/) chat completions — `lib/openrouter.ts` for
  Sports' football-specific prompts, `lib/openrouterMarkets.ts` for Discover's generalized
  any-market prompts (both share the same request/retry/JSON-parsing core in `lib/openrouter.ts`).

## Project structure

```
app/
  page.tsx                            Discover — trending markets across all of Polymarket (home)
  sports/page.tsx                     Sports — the original football-only game list
  picks/page.tsx                      Every saved analysis, football and Discover, merged
  lab/page.tsx                        Build a single/multi bet from any saved pick
  api/markets/route.ts                Fetches + normalizes Discover's trending markets
  api/analyze/market/predict/route.ts Discover step 1: independent AI prediction (any market)
  api/analyze/market/compare/route.ts Discover step 2: compare prediction against market odds
  api/games/route.ts                  Fetches + normalizes Sports' Polymarket games
  api/analyze/predict/route.ts        Sports step 1: independent AI prediction
  api/analyze/compare/route.ts        Sports step 2: compare prediction against market odds
components/                           UI components (game/market cards, analysis sheets, etc.)
lib/                                  Polymarket + OpenRouter integrations, types, formatting, storage
```

## Tech

Next.js (App Router) + TypeScript + Tailwind CSS v4. No database — game data is fetched fresh on
each request, and saved picks live in the browser's `localStorage`.

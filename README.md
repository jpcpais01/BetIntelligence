# BetIntelligence

AI odds-intelligence for Polymarket football (soccer) markets. BetIntelligence pulls upcoming
1X2 matches from Polymarket's top 8 European leagues plus Brazil's Brasileirao, and lets an LLM
form its own opinion before ever seeing the market — then compares the two to flag matches where
the market might be mispriced.

This is a paper-trading / research tool: there is no real-money betting or wallet integration.
"Saving a pick" just stores your AI's read on a match in your browser's local storage.

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
| `MOCK_AI` | No | Set to `1` to return a canned analysis instead of calling OpenRouter. Useful for testing the full analysis flow without spending API credits. |

No API key or account is needed to browse games — Polymarket's Gamma API is public. A key is only
required to run AI analysis.

## Data sources

- **Odds**: [Polymarket's Gamma API](https://docs.polymarket.com/) (`gamma-api.polymarket.com`), no
  auth required. `lib/polymarket.ts` fetches upcoming soccer events, matches them against a keyword
  list for the Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Primeira Liga, Eredivisie,
  Belgian Pro League, and Brasileirao, and derives 1X2 probabilities from each match's three
  moneyline sub-markets.
- **Analysis**: [OpenRouter](https://openrouter.ai/) chat completions, `lib/openrouter.ts`.

## Project structure

```
app/
  page.tsx                    Game list (home)
  picks/page.tsx               Saved paper picks
  api/games/route.ts           Fetches + normalizes Polymarket games
  api/analyze/predict/route.ts Step 1: independent AI prediction
  api/analyze/compare/route.ts Step 2: compare prediction against market odds
components/                    UI components (game cards, analysis sheet, etc.)
lib/                           Polymarket + OpenRouter integrations, types, formatting, storage
```

## Tech

Next.js (App Router) + TypeScript + Tailwind CSS v4. No database — game data is fetched fresh on
each request, and saved picks live in the browser's `localStorage`.

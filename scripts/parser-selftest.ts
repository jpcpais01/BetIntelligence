import { getUpcomingGames } from "../lib/polymarket";

function iso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

// Shapes taken verbatim from the real /api/games/raw dump: three binary Yes/No markets
// per match, labelled via groupItemTitle, with the draw market titled "Draw (A vs. B)".
const eplMatch = {
  id: "900001",
  slug: "epl-ars-che-2026-09-05",
  title: "Arsenal vs. Chelsea",
  startDate: "2026-08-20T10:00:00Z", // market opened weeks before kickoff
  volume: "123456",
  liquidity: "45678",
  tags: [
    { label: "Sports", slug: "sports" },
    { label: "Games", slug: "games" },
    { label: "Soccer", slug: "soccer" },
    { label: "Premier League", slug: "premier-league" },
  ],
  series: [{ title: "Premier League", slug: "premier-league" }],
  markets: [
    {
      question: "Will Arsenal win on 2026-09-05?",
      groupItemTitle: "Arsenal",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.55", "0.45"]',
      startDate: "2026-08-20T10:00:00Z",
      gameStartTime: iso(3),
    },
    {
      question: "Will Arsenal vs. Chelsea end in a draw?",
      groupItemTitle: "Draw (Arsenal vs. Chelsea)",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.25", "0.75"]',
      startDate: "2026-08-20T10:00:05Z",
      gameStartTime: iso(3),
    },
    {
      question: "Will Chelsea win on 2026-09-05?",
      groupItemTitle: "Chelsea",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.20", "0.80"]',
      startDate: "2026-08-20T10:00:10Z",
      gameStartTime: iso(3),
    },
  ],
};

// Same match but with no gameStartTime, to exercise the question-text date fallback.
const laLigaMatch = {
  id: "900002",
  slug: "laliga-rma-bar",
  title: "Real Madrid vs. Barcelona",
  startDate: "2026-07-01T10:00:00Z",
  tags: [
    { label: "Soccer", slug: "soccer" },
    { label: "La Liga", slug: "la-liga" },
  ],
  series: [],
  markets: [
    {
      question: `Will Real Madrid win on ${iso(5).slice(0, 10)}?`,
      groupItemTitle: "Real Madrid",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.44", "0.56"]',
    },
    {
      question: "Will Real Madrid vs. Barcelona end in a draw?",
      groupItemTitle: "Draw (Real Madrid vs. Barcelona)",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.26", "0.74"]',
    },
    {
      question: `Will Barcelona win on ${iso(5).slice(0, 10)}?`,
      groupItemTitle: "Barcelona",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.32", "0.68"]',
    },
  ],
};

// Must be REJECTED: companion event carrying its own valid-looking 3-way structure.
const halftimeCompanion = {
  ...eplMatch,
  id: "900003",
  slug: "epl-ars-che-halftime",
  title: "Arsenal vs. Chelsea - Halftime Result",
};

// Must be REJECTED: futures market that matched our keyword before (Egypt, not England).
const egyptFutures = {
  id: "900004",
  slug: "egypt-premier-league-winner",
  title: "Egypt Premier League: 2026-27 Winner",
  startDate: iso(1),
  tags: [
    { label: "Soccer", slug: "soccer" },
    { label: "Egypt Premier League", slug: "egypt-premier-league" },
  ],
  series: [],
  markets: [
    {
      question: "Will Al Ahly win the Egypt Premier League?",
      groupItemTitle: "Al Ahly",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.5", "0.5"]',
    },
    {
      question: "Will Zamalek win the Egypt Premier League?",
      groupItemTitle: "Zamalek",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.3", "0.7"]',
    },
    {
      question: "Will Pyramids win the Egypt Premier League?",
      groupItemTitle: "Pyramids",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.2", "0.8"]',
    },
  ],
};

// Must be REJECTED: real Serie A futures market (many teams, no draw).
const serieAFutures = {
  id: "900005",
  slug: "serie-a-2027-champion",
  title: "Serie A: 2027 Champion",
  startDate: iso(1),
  tags: [
    { label: "Soccer", slug: "soccer" },
    { label: "Serie A", slug: "serie-a" },
  ],
  series: [],
  markets: [
    {
      question: "Will Inter Milan win the 2026-27 Serie A Championship?",
      groupItemTitle: "Inter Milan",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.465", "0.535"]',
    },
    {
      question: "Will Juventus win the 2026-27 Serie A Championship?",
      groupItemTitle: "Juventus",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.12", "0.88"]',
    },
    {
      question: "Will Napoli win the 2026-27 Serie A Championship?",
      groupItemTitle: "Napoli",
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.065", "0.935"]',
    },
  ],
};

// Must be REJECTED: not one of our target leagues.
const japanMatch = {
  id: "900006",
  slug: "j2-iwa-ven",
  title: "Iwaki FC vs. Ventforet Kofu",
  startDate: iso(1),
  tags: [
    { label: "Soccer", slug: "soccer" },
    { label: "Japan J2 League", slug: "japan-j2-league" },
  ],
  series: [{ title: "Japan J2 League", slug: "japan-j2-league" }],
  markets: eplMatch.markets,
};

// Deliberately excludes eplMatch/halftimeCompanion: those are served ONLY on page 2 of the
// Premier League tag, so the EPL match can only be found if per-league paging actually works.
const ALL_EVENTS = [laLigaMatch, egyptFutures, serieAFutures, japanMatch];

let requestCount = 0;
globalThis.fetch = (async (url: string | URL) => {
  requestCount++;
  const href = typeof url === "string" ? url : url.toString();
  const parsed = new URL(href);
  const offset = Number(parsed.searchParams.get("offset") ?? "0");
  const tagSlug = parsed.searchParams.get("tag_slug");

  // The Premier League tag is served as a FULL first page of nothing but futures and
  // companion events, with the actual fixture only on page 2. This reproduces the real
  // bug: taking just page 0 per league slug silently missed every EPL fixture.
  if (tagSlug === "epl" || tagSlug === "premier-league") {
    if (offset === 0) {
      const filler = Array.from({ length: 100 }, (_, i) => ({
        ...egyptFutures,
        id: `filler-${i}`,
        slug: `filler-${i}`,
        title: `Egypt Premier League: Filler Market ${i}`,
      }));
      return okResponse(filler);
    }
    if (offset === 100) return okResponse([eplMatch, halftimeCompanion]);
    return okResponse([]);
  }

  // Everything else: one page of data, then empty so pagination terminates.
  return okResponse(offset === 0 ? ALL_EVENTS : []);
}) as unknown as typeof fetch;

function okResponse(body: unknown[]) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

async function main() {
  const games = await getUpcomingGames();

  console.log(`\nHTTP requests made: ${requestCount}`);
  console.log(`Games parsed: ${games.length}\n`);
  for (const g of games) {
    console.log(
      `  ${g.leagueFlag} [${g.leagueName}] ${g.homeTeam} vs ${g.awayTeam}\n` +
        `     kickoff: ${g.startTime}\n` +
        `     odds: home ${(g.odds.home * 100).toFixed(1)}% / draw ${(g.odds.draw * 100).toFixed(1)}% / away ${(g.odds.away * 100).toFixed(1)}%\n` +
        `     volume: ${g.volume}`
    );
  }

  const failures: string[] = [];
  const titles = games.map((g) => `${g.homeTeam} vs ${g.awayTeam}`);

  if (games.length !== 2) failures.push(`expected exactly 2 games, got ${games.length}`);
  if (!titles.includes("Arsenal vs Chelsea")) failures.push("missing EPL match");
  if (!titles.includes("Real Madrid vs Barcelona")) failures.push("missing La Liga match (question-date fallback)");

  const epl = games.find((g) => g.homeTeam.startsWith("Arsenal"));
  if (epl) {
    if (epl.league !== "premier-league") failures.push(`EPL match got league ${epl.league}`);
    if (!(epl.odds.home > epl.odds.draw && epl.odds.draw > epl.odds.away)) {
      failures.push("EPL odds ordering wrong (home should beat draw should beat away)");
    }
    const sum = epl.odds.home + epl.odds.draw + epl.odds.away;
    if (Math.abs(sum - 1) > 0.001) failures.push(`EPL odds don't sum to 1 (${sum})`);
    if (new Date(epl.startTime).getTime() < Date.now()) failures.push("EPL kickoff resolved into the past");
  }

  const laliga = games.find((g) => g.homeTeam.startsWith("Real Madrid"));
  if (laliga && laliga.league !== "la-liga") failures.push(`La Liga match got league ${laliga.league}`);

  if (games.some((g) => g.homeTeam.includes("Iwaki"))) failures.push("Japan J2 match should be excluded");
  if (games.some((g) => g.slug.includes("halftime"))) failures.push("halftime companion should be excluded");
  if (games.some((g) => g.slug.includes("egypt"))) failures.push("Egypt futures should be excluded");
  if (games.some((g) => g.slug.includes("2027-champion"))) failures.push("Serie A futures should be excluded");

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll assertions passed.");
}

main();

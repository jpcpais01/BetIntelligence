import { fetchLiveOdds, __resetPartnerSeriesIdCacheForTests } from "../lib/polymarket";

function iso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

// A single 1X2 market event, matching the real /events shape (bare "1"/"X"/"2" outcome labels,
// as official Polymarket partner leagues use) — kept minimal since these tests only care about
// which requests fire and whether the right odds come back, not full parser coverage (that's
// scripts/parser-selftest.ts's job).
function match(opts: {
  id: string;
  home: string;
  away: string;
  homePrice: number;
  drawPrice: number;
  awayPrice: number;
  // A human-readable league label ("Premier League", not "premier-league") — matchLeague's
  // keyword check needs the space-separated form, same as parser-selftest.ts's real fixtures.
  leagueLabel: string;
}) {
  return {
    id: opts.id,
    slug: `${opts.home}-vs-${opts.away}`.toLowerCase().replace(/\s+/g, "-"),
    title: `${opts.home} vs. ${opts.away}`,
    startDate: iso(-1),
    volume: "1000",
    liquidity: "500",
    tags: [{ label: opts.leagueLabel, slug: opts.leagueLabel.toLowerCase().replace(/\s+/g, "-") }],
    markets: [
      {
        question: `${opts.home} vs. ${opts.away}`,
        outcomes: '["1", "X", "2"]',
        outcomePrices: JSON.stringify([opts.homePrice, opts.drawPrice, opts.awayPrice]),
        gameStartTime: iso(-1),
      },
    ],
  };
}

function ok(body: unknown[]) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => JSON.stringify(body) };
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- A non-partner league resolves via its tag_slug alone, no /series call needed ---
  {
    __resetPartnerSeriesIdCacheForTests();
    const urls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      urls.push(u);
      const parsed = new URL(u);
      if (parsed.pathname.endsWith("/series")) return ok([]);
      const tagSlug = parsed.searchParams.get("tag_slug");
      const offset = Number(parsed.searchParams.get("offset") ?? "0");
      if (tagSlug === "bundesliga" && offset === 0) {
        return ok([
          match({
            id: "b1",
            home: "Bayern Munich",
            away: "Dortmund",
            homePrice: 0.6,
            drawPrice: 0.25,
            awayPrice: 0.15,
            leagueLabel: "Bundesliga",
          }),
        ]);
      }
      return ok([]);
    }) as unknown as typeof fetch;

    const odds = await fetchLiveOdds([{ id: "b1", league: "bundesliga" }]);
    check("returns updated odds for the requested game", odds.b1?.home === 0.6 && odds.b1?.draw === 0.25 && odds.b1?.away === 0.15, JSON.stringify(odds));
    check("never calls /series for a non-partner league", !urls.some((u) => u.includes("/series")), urls.join(" | "));
    check("only fetches page 0 (bounded, not a full sweep)", urls.every((u) => new URL(u).searchParams.get("offset") === "0" || new URL(u).searchParams.get("offset") === null), urls.join(" | "));
  }

  // --- A partner league resolves its series_id via /series, then fetches by series_id, and
  // caches that resolution so a LATER call doesn't repeat the (multi-request) /series sweep ---
  {
    __resetPartnerSeriesIdCacheForTests();
    let seriesCalls = 0;
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      const parsed = new URL(u);
      if (parsed.pathname.endsWith("/series")) {
        seriesCalls++;
        return ok([{ id: 42, slug: "premier-league-2026", title: "Premier League" }]);
      }
      const seriesId = parsed.searchParams.get("series_id");
      if (seriesId === "42") {
        return ok([
          match({
            id: "p1",
            home: "Arsenal",
            away: "Chelsea",
            homePrice: 0.5,
            drawPrice: 0.3,
            awayPrice: 0.2,
            leagueLabel: "Premier League",
          }),
        ]);
      }
      return ok([]);
    }) as unknown as typeof fetch;

    const odds = await fetchLiveOdds([{ id: "p1", league: "premier-league" }]);
    check("resolves the partner league's odds via series_id", odds.p1?.home === 0.5, JSON.stringify(odds));
    check("/series was actually called to resolve the series_id", seriesCalls > 0, `${seriesCalls}`);

    // A second call for the SAME partner league should reuse the cached series_id from the first
    // call's /series sweep, not repeat that (multi-request) discovery sweep at all.
    const seriesCallsAfterFirst = seriesCalls;
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      const parsed = new URL(u);
      if (parsed.pathname.endsWith("/series")) {
        seriesCalls++;
        return ok([]);
      }
      return ok([]);
    }) as unknown as typeof fetch;
    await fetchLiveOdds([{ id: "p1", league: "premier-league" }]);
    check(
      "a second call for the same partner league reuses the cached series_id, no new /series calls",
      seriesCalls === seriesCallsAfterFirst,
      `${seriesCallsAfterFirst} -> ${seriesCalls}`
    );
  }

  // --- A requested game that isn't in what comes back is just absent, not an error ---
  {
    __resetPartnerSeriesIdCacheForTests();
    globalThis.fetch = (async () => ok([])) as unknown as typeof fetch;
    const odds = await fetchLiveOdds([{ id: "missing", league: "ligue-1" }]);
    check("an unmatched game is simply absent from the result", odds.missing === undefined, JSON.stringify(odds));
  }

  // --- Multiple distinct leagues in one call each get their own request, merged into one result ---
  {
    __resetPartnerSeriesIdCacheForTests();
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      const parsed = new URL(u);
      if (parsed.pathname.endsWith("/series")) return ok([]);
      const tagSlug = parsed.searchParams.get("tag_slug");
      if (tagSlug === "ligue-1") {
        return ok([
          match({ id: "l1", home: "PSG", away: "Marseille", homePrice: 0.7, drawPrice: 0.2, awayPrice: 0.1, leagueLabel: "Ligue 1" }),
        ]);
      }
      if (tagSlug === "eredivisie" || tagSlug === "dutch-eredivisie") {
        return ok([
          match({ id: "e1", home: "Ajax", away: "PSV", homePrice: 0.4, drawPrice: 0.3, awayPrice: 0.3, leagueLabel: "Eredivisie" }),
        ]);
      }
      return ok([]);
    }) as unknown as typeof fetch;

    const odds = await fetchLiveOdds([
      { id: "l1", league: "ligue-1" },
      { id: "e1", league: "eredivisie" },
    ]);
    const close = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-9;
    check(
      "both leagues' games come back in one merged result",
      close(odds.l1?.home, 0.7) && close(odds.e1?.home, 0.4),
      JSON.stringify(odds)
    );
  }

  // --- Empty input returns an empty result with no requests at all ---
  {
    __resetPartnerSeriesIdCacheForTests();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return ok([]);
    }) as unknown as typeof fetch;
    const odds = await fetchLiveOdds([]);
    check("empty input makes no requests", calls === 0, `${calls}`);
    check("empty input returns an empty result", Object.keys(odds).length === 0, JSON.stringify(odds));
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll live-odds cases passed.");
}

run();

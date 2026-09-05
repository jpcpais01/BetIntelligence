import { fetchOutcomeHistory, fetchHistorySeries, isHistoryWindow } from "../lib/oddsHistoryServer";
import { generateMockHistory } from "../lib/mockOddsHistory";

type FakeResponse = { ok: boolean; json: () => Promise<unknown> };

function fakeFetch(responses: FakeResponse[]): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return r as unknown as Response;
  }) as typeof fetch;
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // A normal CLOB prices-history response: unix-seconds timestamps, 0-1 prices.
  {
    const fetchImpl = fakeFetch([
      { ok: true, json: async () => ({ history: [{ t: 1700000000, p: 0.55 }, { t: 1700003600, p: 0.58 }] }) },
    ]);
    const points = await fetchOutcomeHistory("token-1", fetchImpl);
    check("parses a well-formed history response into ISO points", points.length === 2);
    check(
      "converts unix seconds to an ISO timestamp",
      points[0]?.t === new Date(1700000000 * 1000).toISOString(),
      points[0]?.t
    );
    check("preserves the price value", points[1]?.p === 0.58);
  }

  // A market with no trading history yet legitimately 404s — that's "nothing to chart", not an
  // error worth throwing.
  {
    const fetchImpl = fakeFetch([{ ok: false, json: async () => ({}) }]);
    const points = await fetchOutcomeHistory("token-thin", fetchImpl);
    check("a non-ok response yields an empty series rather than throwing", points.length === 0);
  }

  // A response whose `history` field isn't an array at all (unexpected shape) degrades to empty
  // rather than crashing the caller.
  {
    const fetchImpl = fakeFetch([{ ok: true, json: async () => ({ history: "not-an-array" }) }]);
    const points = await fetchOutcomeHistory("token-weird", fetchImpl);
    check("a malformed history field yields an empty series", points.length === 0);
  }

  // Points missing t or p are dropped rather than propagating NaN/undefined into the chart.
  {
    const fetchImpl = fakeFetch([
      { ok: true, json: async () => ({ history: [{ t: 1700000000, p: 0.5 }, { t: 1700003600 }, { p: 0.4 }] }) },
    ]);
    const points = await fetchOutcomeHistory("token-partial", fetchImpl);
    check("drops entries missing t or p", points.length === 1, String(points.length));
  }

  // A thrown fetch (network error) is caught, not left to blow up the whole multi-outcome request.
  {
    const throwingFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const points = await fetchOutcomeHistory("token-err", throwingFetch);
    check("a thrown fetch yields an empty series", points.length === 0);
  }

  // fetchHistorySeries: a null tokenId (Gamma didn't give us one for this outcome) skips the
  // fetch entirely rather than calling the CLOB API with an empty string.
  {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return { ok: true, json: async () => ({ history: [] }) } as unknown as Response;
    }) as typeof fetch;
    const series = await fetchHistorySeries(
      [
        { label: "Home", tokenId: "real-token" },
        { label: "Draw", tokenId: null },
      ],
      fetchImpl
    );
    check("fetchHistorySeries preserves outcome order and labels", series[0].label === "Home" && series[1].label === "Draw");
    check("a null tokenId short-circuits to an empty series with no fetch", series[1].points.length === 0 && calls === 1, String(calls));
  }

  // Each window asks CLOB for a different interval/fidelity (default omitted == "7d", unchanged
  // from before these existed) — the exact reported ask: 3H should be higher resolution than 1D,
  // 1D higher resolution than 7D.
  {
    const urls: string[] = [];
    const fetchImpl = (async (url: unknown) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ history: [] }) } as unknown as Response;
    }) as typeof fetch;

    await fetchOutcomeHistory("token-1", fetchImpl);
    await fetchOutcomeHistory("token-1", fetchImpl, "7d");
    await fetchOutcomeHistory("token-1", fetchImpl, "1d");
    await fetchOutcomeHistory("token-1", fetchImpl, "3h");
    await fetchOutcomeHistory("token-1", fetchImpl, "live");

    check("omitting the window defaults to the original 7d request (backward compatible)", urls[0] === urls[1], urls[0]);
    check("7d asks for a 1-week interval", urls[0].includes("interval=1w") && urls[0].includes("fidelity=180"), urls[0]);
    check("1d asks for a finer interval than 7d", urls[2].includes("interval=1d") && urls[2].includes("fidelity=30"), urls[2]);
    check(
      "3h asks for an even finer fidelity than 1d (CLOB has no exact 3h interval, so it over-fetches 6h at 5-minute fidelity and the chart trims it client-side)",
      urls[3].includes("interval=6h") && urls[3].includes("fidelity=5"),
      urls[3]
    );
    check(
      "live reuses 3h's own 6h interval (no exact CLOB match for it either) but at 1-minute fidelity — the finest of all four, since the chart trims it down to this specific match's own elapsed time, not a fixed span",
      urls[4].includes("interval=6h") && urls[4].includes("fidelity=1"),
      urls[4]
    );
  }

  // isHistoryWindow: the route's own validation for a client-supplied window param — an unknown
  // value must never reach WINDOW_CONFIG (which would throw on a missing key), it should just
  // fall back to the default the way an omitted param already does.
  check("a known window id is recognized", isHistoryWindow("1d") === true);
  check("the live window id is recognized too", isHistoryWindow("live") === true);
  check("an unknown string is rejected", isHistoryWindow("1y") === false);
  check("a non-string value is rejected", isHistoryWindow(null) === false);

  // Mock history generator: deterministic per label, and always lands on the real current price.
  // `now` is pinned so two calls can't land on different sides of a millisecond boundary and
  // produce different timestamps despite an identical underlying walk.
  {
    const now = Date.now();
    const a = generateMockHistory("Arsenal", 0.62, now);
    const b = generateMockHistory("Arsenal", 0.62, now);
    check("same label + price generates an identical series (deterministic seed)", JSON.stringify(a) === JSON.stringify(b));

    const other = generateMockHistory("Chelsea", 0.62, now);
    check("a different label generates a different series", JSON.stringify(a) !== JSON.stringify(other));

    check("the series ends exactly on the real current price", a[a.length - 1].p === 0.62, String(a[a.length - 1].p));

    const times = a.map((p) => new Date(p.t).getTime());
    const sorted = [...times].sort((x, y) => x - y);
    check("points are in chronological order", JSON.stringify(times) === JSON.stringify(sorted));
    check("every price stays within (0, 1)", a.every((p) => p.p > 0 && p.p < 1));

    // The exact reported ask, mirrored in mock mode: 3h resolution finer than 1d, 1d finer than
    // 7d. "Resolution" here is bucket spacing (window span / point count), not raw point count,
    // since the windows span different lengths of time.
    const bucketSpacingMs = (points: ReturnType<typeof generateMockHistory>) => {
      const ts = points.map((p) => new Date(p.t).getTime());
      return (Math.max(...ts) - Math.min(...ts)) / (points.length - 1);
    };
    const spacing7d = bucketSpacingMs(generateMockHistory("Arsenal", 0.62, now, "7d"));
    const spacing1d = bucketSpacingMs(generateMockHistory("Arsenal", 0.62, now, "1d"));
    const spacing3h = bucketSpacingMs(generateMockHistory("Arsenal", 0.62, now, "3h"));
    const spacingLive = bucketSpacingMs(generateMockHistory("Arsenal", 0.62, now, "live"));
    check("1d mock data is finer resolution than 7d", spacing1d < spacing7d, `${spacing1d} vs ${spacing7d}`);
    check("3h mock data is finer resolution than 1d", spacing3h < spacing1d, `${spacing3h} vs ${spacing1d}`);
    check(
      "live mock data is finer resolution still (1-minute fidelity, the finest of the four)",
      spacingLive < spacing3h,
      `${spacingLive} vs ${spacing3h}`
    );
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll odds-history cases passed.");
}

run();

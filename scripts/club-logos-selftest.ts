import { getClubLogos } from "../lib/clubLogos";

function ok(teams: unknown[]) {
  return { ok: true, json: async () => ({ teams }) };
}

function team(opts: { strTeam?: string; strAlternate?: string; strBadge?: string; strSport?: string }) {
  return { strSport: "Soccer", strBadge: "https://example.com/badge.png", ...opts };
}

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- A single, name-verified result resolves normally ---
  {
    const urls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      urls.push(String(url));
      return ok([team({ strTeam: "Arsenal" })]);
    }) as unknown as typeof fetch;

    const [result] = await getClubLogos(["Arsenal"]);
    check("a clean single match resolves a badge", result.logoUrl === "https://example.com/badge.png");
    check("exactly one request is made when the first query already resolves", urls.length === 1, String(urls.length));
  }

  // --- Several candidates come back (a same-named or same-sport-tagged team elsewhere) — the
  // one whose own name actually matches the query wins, never just index 0. This is the direct
  // fix for "wrong logo": TheSportsDB search returning more than one team no longer means
  // whichever one happened to sort first gets shown. ---
  {
    globalThis.fetch = (async () =>
      ok([
        team({ strTeam: "Real Sociedad B", strBadge: "https://example.com/wrong.png" }),
        team({ strTeam: "Real Sociedad", strBadge: "https://example.com/right.png" }),
      ])) as unknown as typeof fetch;

    const [result] = await getClubLogos(["Real Sociedad"]);
    check(
      "the name-verified candidate wins over an earlier same-sport candidate",
      result.logoUrl === "https://example.com/right.png",
      String(result.logoUrl)
    );
  }

  // --- A single result that doesn't actually match the query name at all is rejected rather
  // than shown as a wrong crest — the defense against a search that hands back an unrelated
  // team (a demo-key quirk, or just an odd ranking) for a query it has no real answer for. ---
  {
    globalThis.fetch = (async () => ok([team({ strTeam: "Arsenal" })])) as unknown as typeof fetch;
    const [result] = await getClubLogos(["Real Madrid"]);
    check(
      "an unrelated lone result is rejected rather than shown as this club's crest",
      result.logoUrl === null,
      String(result.logoUrl)
    );
  }

  // --- A club is resolved via its strAlternate field, not just strTeam ---
  {
    globalThis.fetch = (async () =>
      ok([team({ strTeam: "Inter", strAlternate: "Internazionale, Inter Milan, FC Internazionale Milano" })])) as unknown as typeof fetch;
    const [result] = await getClubLogos(["Inter Milan"]);
    check("a match via strAlternate resolves the badge", result.logoUrl === "https://example.com/badge.png");
  }

  // --- PSG: the exact Polymarket name fails outright, but the curated "PSG" alias (already
  // trusted elsewhere in this app, lib/topTeams.ts) resolves it on retry. Verified against the
  // ALIAS itself, not the original name — "PSG" and "Paris Saint-Germain" don't pass any tier of
  // name-similarity against each other, so this only works because the query that actually
  // produced a result is what gets checked. ---
  {
    const urls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      urls.push(u);
      const parsed = new URL(u);
      const q = parsed.searchParams.get("t");
      if (q === "PSG") return ok([team({ strTeam: "Paris SG" })]);
      return ok([]);
    }) as unknown as typeof fetch;

    const [result] = await getClubLogos(["Paris Saint-Germain"]);
    check("PSG resolves via the curated alias retry", result.logoUrl === "https://example.com/badge.png", String(result.logoUrl));
    check("the PSG alias was actually tried", urls.some((u) => new URL(u).searchParams.get("t") === "PSG"), urls.join(" | "));
  }

  // --- A club outside the curated top-team list gets no alias retry, only the generic
  // accent/hyphen variants — resolving via a de-accented query ---
  {
    const urls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      urls.push(u);
      const parsed = new URL(u);
      const q = parsed.searchParams.get("t") ?? "";
      if (q === "Malaga") return ok([team({ strTeam: "Malaga" })]);
      return ok([]);
    }) as unknown as typeof fetch;

    const [result] = await getClubLogos(["Málaga"]);
    check("an accented name resolves via the de-accented retry", result.logoUrl === "https://example.com/badge.png", String(result.logoUrl));
    check("exactly two queries were tried (exact, then de-accented)", urls.length === 2, String(urls.length));
  }

  // --- A hyphenated name resolves once hyphens are turned into spaces ---
  {
    globalThis.fetch = (async (url: unknown) => {
      const parsed = new URL(String(url));
      const q = parsed.searchParams.get("t") ?? "";
      if (q === "Union Saint Gilloise") return ok([team({ strTeam: "Union Saint Gilloise" })]);
      return ok([]);
    }) as unknown as typeof fetch;

    const [result] = await getClubLogos(["Union Saint-Gilloise"]);
    check(
      "a hyphenated name resolves once hyphens become spaces",
      result.logoUrl === "https://example.com/badge.png",
      String(result.logoUrl)
    );
  }

  // --- Nothing resolves at all across every variant tried ---
  {
    globalThis.fetch = (async () => ok([])) as unknown as typeof fetch;
    const [result] = await getClubLogos(["Some Obscure FC"]);
    check("no crest anywhere just means null, not a crash", result.logoUrl === null);
  }

  // --- A thrown fetch never propagates out of getClubLogos ---
  {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    let threw = false;
    try {
      await getClubLogos(["Arsenal"]);
    } catch {
      threw = true;
    }
    check("a thrown fetch never propagates", !threw);
  }

  // --- Duplicate/blank names are deduped and dropped before any request is made ---
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return ok([team({ strTeam: "Arsenal" })]);
    }) as unknown as typeof fetch;
    const results = await getClubLogos(["Arsenal", "Arsenal", "  ", ""]);
    check("blank names are dropped, duplicates deduped", results.length === 1, String(results.length));
    check("exactly one request is made for the one real name", calls === 1, String(calls));
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll club-logos cases passed.");
}

run();

import { teamNamesMatch, anyTeamNameMatches, findBestNameMatch } from "../lib/teamNameMatching";

function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- teamNamesMatch: pairwise checks ---
  check("identical names match", teamNamesMatch("Arsenal", "Arsenal"));
  check("case/diacritic-insensitive exact match", teamNamesMatch("Bayer Leverkusen", "BAYER LEVERKUSEN"));
  check("a shortened display name matches via substring", teamNamesMatch("Newcastle", "Newcastle United"));
  check(
    "a full legal name with a founding-year number matches (the Dortmund case)",
    teamNamesMatch("BV Borussia 09 Dortmund", "Borussia Dortmund")
  );
  check("a founding-year number matches the other direction too", teamNamesMatch("Borussia Dortmund", "BV Borussia 09 Dortmund"));
  check("TSG 1899 Hoffenheim matches Hoffenheim's shorter roster name", teamNamesMatch("TSG 1899 Hoffenheim", "Hoffenheim"));
  check("unrelated clubs do not match", !teamNamesMatch("Arsenal", "Chelsea"));
  check("empty strings never match", !teamNamesMatch("", "Arsenal"));
  check("two empty strings do not match either", !teamNamesMatch("", ""));

  // --- anyTeamNameMatches: the full-vs-short-name problem ---
  //
  // football-data.org returns both a full legal name and a short one. For these clubs the full
  // name alone does NOT match what Polymarket calls them, so checking only it is why their live
  // scores never appeared and their bets never settled — while every other club worked fine,
  // which is exactly what made the bug look random.
  const shortNameOnlyCases: [string, string, string][] = [
    ["Man City", "Manchester City FC", "Man City"],
    ["Wolves", "Wolverhampton Wanderers FC", "Wolves"],
    ["Spurs", "Tottenham Hotspur FC", "Spurs"],
    ["Inter Milan", "FC Internazionale Milano", "Inter"],
    ["PSG", "Paris Saint-Germain FC", "PSG"],
  ];
  for (const [polymarketName, fullName, shortName] of shortNameOnlyCases) {
    check(
      `"${polymarketName}" does not match the full name "${fullName}" on its own`,
      !teamNamesMatch(fullName, polymarketName)
    );
    check(
      `"${polymarketName}" is found once the short name is considered too`,
      anyTeamNameMatches([fullName, shortName], polymarketName)
    );
  }

  check(
    "a club whose full name already matches still matches with a short name present",
    anyTeamNameMatches(["Nottingham Forest FC", "Nottingham"], "Nottingham Forest")
  );
  check(
    "a missing short name is skipped rather than breaking the check",
    anyTeamNameMatches(["Arsenal FC", undefined], "Arsenal")
  );
  check("an unrelated club still does not match on either name", !anyTeamNameMatches(["Chelsea FC", "Chelsea"], "Arsenal"));
  check("no candidate names at all never matches", !anyTeamNameMatches([], "Arsenal"));

  // --- findBestNameMatch: picks the best of a list, tiered ---
  interface Team {
    name: string;
    shortName?: string;
  }
  const teams: Team[] = [
    { name: "Arsenal", shortName: "Arsenal FC" },
    { name: "Borussia Dortmund" },
    { name: "Bayern Munich", shortName: "FC Bayern" },
  ];
  const getNames = (t: Team) => [t.name, t.shortName];

  check(
    "exact match wins",
    findBestNameMatch(teams, getNames, "Arsenal")?.name === "Arsenal"
  );
  check(
    "matches via the shortName field, not just name",
    findBestNameMatch(teams, getNames, "FC Bayern")?.name === "Bayern Munich"
  );
  check(
    "founding-year full legal name resolves to the right roster entry",
    findBestNameMatch(teams, getNames, "BV Borussia 09 Dortmund")?.name === "Borussia Dortmund"
  );
  check("no match returns null, not a guess", findBestNameMatch(teams, getNames, "Some Random Club") === null);
  check("an empty roster returns null", findBestNameMatch([], getNames, "Arsenal") === null);

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll team-name-matching cases passed.");
}

run();

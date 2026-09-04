import { teamNamesMatch, findBestNameMatch } from "../lib/teamNameMatching";

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

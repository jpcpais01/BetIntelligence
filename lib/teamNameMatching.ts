// Shared "does this display name refer to the same club as that roster entry" matching, used by
// every provider that hands us a team name to look up (football-data.org, Big Balls Sports Data)
// against Polymarket's own team name string. Three tiers, most to least strict:
//   1. Exact match after normalizing case/diacritics/punctuation.
//   2. Substring either direction — handles a shortened or lengthened display name
//      ("Newcastle" vs "Newcastle United").
//   3. Word-set overlap with purely-numeric tokens dropped — handles a club's full legal name
//      carrying an extra founding-year number that breaks contiguous substring matching
//      ("BV Borussia 09 Dortmund" vs a roster's plain "Borussia Dortmund").

export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function significantWords(name: string): string[] {
  return normalizeTeamName(name)
    .split(" ")
    .filter((w) => w.length > 0 && !/^\d+$/.test(w));
}

function wordSetOverlap(a: string, b: string): boolean {
  const wordsA = significantWords(a);
  const wordsB = significantWords(b);
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  return wordsA.every((w) => setB.has(w)) || wordsB.every((w) => setA.has(w));
}

// Pairwise check — used when filtering records that belong to a known team (e.g. an injuries
// list) rather than picking the single best match out of a roster.
export function teamNamesMatch(a: string, b: string): boolean {
  const normA = normalizeTeamName(a);
  const normB = normalizeTeamName(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;
  return wordSetOverlap(a, b);
}

// Picks the single best-matching item out of a roster for a target display name, trying each
// tier across the WHOLE list before falling back to the next (so an exact match anywhere in the
// list always wins over a looser match elsewhere in it). `getNames` returns every display name an
// item could be matched under (e.g. a team's full name and its short name); a candidate matches
// if ANY of them does.
export function findBestNameMatch<T>(
  items: T[],
  getNames: (item: T) => (string | undefined)[],
  target: string
): T | null {
  const targetNorm = normalizeTeamName(target);

  const exact = items.find((item) =>
    getNames(item).some((name) => name !== undefined && normalizeTeamName(name) === targetNorm)
  );
  if (exact) return exact;

  const substring = items.find((item) =>
    getNames(item).some((name) => {
      if (name === undefined) return false;
      const n = normalizeTeamName(name);
      return n.length > 0 && (n.includes(targetNorm) || targetNorm.includes(n));
    })
  );
  if (substring) return substring;

  return (
    items.find((item) => getNames(item).some((name) => name !== undefined && wordSetOverlap(name, target))) ?? null
  );
}

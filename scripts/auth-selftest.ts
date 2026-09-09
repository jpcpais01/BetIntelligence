// Node has no localStorage — same in-memory stand-in used by scripts/last-analysis-selftest.ts.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}
(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
  localStorage: new MemoryStorage(),
};

process.env.SESSION_SECRET = "test-secret-do-not-use-in-real-deployments";

import { usernameError, passwordError, normalizeUsername } from "../lib/auth/users";
import { hashPassword, verifyPassword } from "../lib/auth/passwords";
import { createSessionToken, verifySessionToken } from "../lib/auth/session";
import { collectLocalSnapshot, hasLocalDataToMigrate } from "../lib/auth/localSnapshot";
import { MIGRATABLE_KEYS } from "../lib/auth/migratableKeys";

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };

  // --- Username validation ---
  check("a normal username passes", usernameError("alice_92") === null);
  check("too short is rejected", usernameError("ab") !== null);
  check("too long (25 chars) is rejected", usernameError("a".repeat(25)) !== null);
  check("exactly 24 chars is accepted", usernameError("a".repeat(24)) === null);
  check("spaces are rejected", usernameError("alice smith") !== null);
  check("an @ symbol (this isn't email) is rejected", usernameError("alice@example.com") !== null);
  check("dots/hyphens/underscores are allowed", usernameError("a.b-c_d") === null);

  // --- Password validation ---
  check("a short password is rejected", passwordError("short1") !== null);
  check("an 8-char password is accepted", passwordError("exactly8") === null);
  check("a long password is accepted", passwordError("a much longer passphrase") === null);

  // --- Username normalization: case/whitespace-insensitive identity ---
  check("normalization lowercases", normalizeUsername("Alice") === "alice");
  check("normalization trims whitespace", normalizeUsername("  bob  ") === "bob");
  check("'Alice' and 'alice' normalize identically (one account, not two)", normalizeUsername("Alice") === normalizeUsername("alice"));

  // --- Password hashing: bcrypt round-trips, never stores the plaintext ---
  {
    const hash = await hashPassword("correct horse battery staple");
    check("the hash is not the plaintext password", hash !== "correct horse battery staple");
    check("the right password verifies", await verifyPassword("correct horse battery staple", hash));
    check("the wrong password does not verify", !(await verifyPassword("wrong password", hash)));
    const hash2 = await hashPassword("correct horse battery staple");
    check("hashing the same password twice produces different hashes (a real salt each time)", hash !== hash2);
  }

  // --- Session tokens: signed, forgeable-proof, expiring ---
  {
    const token = createSessionToken("alice");
    check("a freshly created token verifies back to the same username", verifySessionToken(token) === "alice");
    check("garbage input never verifies, never throws", verifySessionToken("not-a-real-token") === null);
    check("an empty/missing token never verifies", verifySessionToken(undefined) === null && verifySessionToken(null) === null);

    // Tamper with the signature — a forged/edited token must never verify.
    const [payload, sig] = token.split(".");
    const tampered = `${payload}.${sig.slice(0, -2)}xx`;
    check("a token with a tampered signature does not verify", verifySessionToken(tampered) === null);

    // Tamper with the payload (try to become a different user without a valid signature for it).
    const forgedPayload = Buffer.from(JSON.stringify({ u: "admin", exp: Date.now() + 1_000_000 })).toString("base64url");
    check("a token with a forged payload (mismatched signature) does not verify", verifySessionToken(`${forgedPayload}.${sig}`) === null);

    // An already-expired token must never verify, even with a perfectly valid signature — built by
    // briefly rewinding Date.now() so createSessionToken's own (always-future-relative) expiry
    // lands in the past by the time verifySessionToken checks it against the real clock again.
    const realDateNow = Date.now;
    Date.now = () => realDateNow() - 40 * 24 * 60 * 60 * 1000; // 40 days ago — past the 30-day TTL
    const expiredToken = createSessionToken("alice");
    Date.now = realDateNow;
    check("a validly-signed but expired token is rejected, not accepted on signature alone", verifySessionToken(expiredToken) === null);
  }

  // --- Local data snapshot: collects only known keys, skips corrupted/missing ones ---
  {
    window.localStorage.setItem(MIGRATABLE_KEYS.picks, JSON.stringify([{ id: "p1" }]));
    window.localStorage.setItem(MIGRATABLE_KEYS.placedBets, JSON.stringify([{ id: "b1" }]));
    window.localStorage.setItem("betintelligence.games.v1", JSON.stringify([{ id: "not-migratable" }])); // a pure cache, not in MIGRATABLE_KEYS
    window.localStorage.setItem(MIGRATABLE_KEYS.model, "{{{not valid json");

    const snapshot = collectLocalSnapshot();
    check("known keys with real data are collected", Array.isArray(snapshot.picks) && Array.isArray(snapshot.placedBets));
    check("a pure-cache key not on the allowlist is never collected", !("games" in snapshot));
    check("corrupted JSON for one key is skipped, not thrown", !("model" in snapshot));
    check("a key never written at all is simply absent", !("leaguePrefs" in snapshot));
    check("hasLocalDataToMigrate is true when there's something to bring over", hasLocalDataToMigrate());
  }
  {
    window.localStorage.clear();
    check("an empty browser profile has nothing to migrate", !hasLocalDataToMigrate());
    check("collectLocalSnapshot on an empty profile returns an empty object", Object.keys(collectLocalSnapshot()).length === 0);
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll auth cases passed.");
}

run();

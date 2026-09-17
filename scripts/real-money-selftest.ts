// Node has no localStorage — a tiny in-memory stand-in lets lib/realMoney/wallet.ts run its real
// code path (the JSON round trip) instead of being mocked away. Same pattern as
// scripts/placed-bets-selftest.ts.
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
}
(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = {
  localStorage: new MemoryStorage(),
};

import { encryptSecret, decryptSecret } from "../lib/realMoney/crypto";
import {
  addressFromPrivateKey,
  saveWallet,
  loadStoredWalletMeta,
  unlockWallet,
  clearStoredWallet,
  hasStoredWallet,
  InvalidPrivateKeyError,
  WrongPassphraseError,
  NoStoredWalletError,
} from "../lib/realMoney/wallet";
import { loadBetMode, saveBetMode } from "../lib/realMoney/mode";

// A well-known, publicly-documented local test account (Hardhat/Anvil's default account #0) —
// never used on any real network, safe to hardcode as a test vector. Verified independently
// against viem's own privateKeyToAccount before being hardcoded here, not assumed from memory.
const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

async function run() {
  const failures: string[] = [];
  const check = (name: string, cond: boolean, detail?: string) => {
    if (!cond) failures.push(detail ? `${name}: ${detail}` : name);
    console.log(`  ${cond ? "ok" : "FAIL"}  ${name}`);
  };
  const checkThrows = async (name: string, fn: () => unknown | Promise<unknown>, isExpected: (err: unknown) => boolean) => {
    try {
      await fn();
      check(name, false, "did not throw");
    } catch (err) {
      check(name, isExpected(err), err instanceof Error ? err.message : String(err));
    }
  };

  // --- crypto.ts: the actual encryption doing the real work ---
  const secret = "0x" + "ab".repeat(32);
  const encrypted = await encryptSecret(secret, "correct horse battery staple");
  const decrypted = await decryptSecret(encrypted, "correct horse battery staple");
  check("a secret round-trips through encrypt/decrypt with the right passphrase", decrypted === secret);

  await checkThrows(
    "the wrong passphrase fails to decrypt rather than returning garbage",
    () => decryptSecret(encrypted, "wrong passphrase"),
    () => true
  );

  const encryptedAgain = await encryptSecret(secret, "correct horse battery staple");
  check(
    "encrypting the same secret twice produces different ciphertext (a real random salt/iv each time)",
    encryptedAgain.ciphertextB64 !== encrypted.ciphertextB64 || encryptedAgain.saltB64 !== encrypted.saltB64
  );

  // --- wallet.ts: address derivation ---
  check(
    "a known private key derives its known real address",
    addressFromPrivateKey(TEST_PRIVATE_KEY).toLowerCase() === TEST_ADDRESS.toLowerCase()
  );
  check(
    "the same key without its 0x prefix derives the identical address",
    addressFromPrivateKey(TEST_PRIVATE_KEY.slice(2)).toLowerCase() === TEST_ADDRESS.toLowerCase()
  );
  check(
    "surrounding whitespace is trimmed before parsing",
    addressFromPrivateKey(`  ${TEST_PRIVATE_KEY}  `).toLowerCase() === TEST_ADDRESS.toLowerCase()
  );
  check("too-short input is rejected", (() => {
    try {
      addressFromPrivateKey("0x1234");
      return false;
    } catch (err) {
      return err instanceof InvalidPrivateKeyError;
    }
  })());
  check("non-hex input is rejected", (() => {
    try {
      addressFromPrivateKey("not a private key at all, obviously");
      return false;
    } catch (err) {
      return err instanceof InvalidPrivateKeyError;
    }
  })());

  // --- wallet.ts: storage round trip (via the in-memory localStorage shim above) ---
  check("no wallet is stored at the start", !hasStoredWallet());

  const meta = await saveWallet({
    privateKeyInput: TEST_PRIVATE_KEY,
    passphrase: "hunter2hunter2",
    signatureType: 0,
  });
  check("saving derives the correct address as metadata", meta.address.toLowerCase() === TEST_ADDRESS.toLowerCase());
  check(
    "signatureType 0 (browser wallet) defaults funder to the wallet's own address",
    meta.funder.toLowerCase() === TEST_ADDRESS.toLowerCase()
  );
  check("a wallet is now stored", hasStoredWallet());

  const loadedMeta = loadStoredWalletMeta();
  check("stored metadata reads back without needing the passphrase", loadedMeta?.address === meta.address);

  const unlocked = await unlockWallet("hunter2hunter2");
  check("unlocking with the right passphrase returns the original private key", unlocked.privateKey.toLowerCase() === TEST_PRIVATE_KEY.toLowerCase());

  await checkThrows(
    "unlocking with the wrong passphrase throws WrongPassphraseError",
    () => unlockWallet("not the passphrase"),
    (err) => err instanceof WrongPassphraseError
  );

  // signatureType 1 (email/Magic) needs an explicit, different funder address — a genuinely
  // separate proxy address, not the EOA itself.
  const proxyFunder = "0x000000000000000000000000000000000000dEaD";
  const proxyMeta = await saveWallet({
    privateKeyInput: TEST_PRIVATE_KEY,
    passphrase: "anotherpass1",
    signatureType: 1,
    funder: proxyFunder,
  });
  check("an explicit funder is kept as given for signatureType 1", proxyMeta.funder.toLowerCase() === proxyFunder.toLowerCase());

  clearStoredWallet();
  check("disconnecting removes the stored wallet", !hasStoredWallet());

  await checkThrows(
    "unlocking with nothing stored throws NoStoredWalletError",
    () => unlockWallet("anything"),
    (err) => err instanceof NoStoredWalletError
  );

  // --- mode.ts ---
  check("bet mode defaults to paper with nothing stored", loadBetMode() === "paper");
  saveBetMode("real");
  check("bet mode round-trips through save/load", loadBetMode() === "real");
  saveBetMode("paper");
  check("switching back to paper round-trips too", loadBetMode() === "paper");

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll real-money cases passed.");
}

run();

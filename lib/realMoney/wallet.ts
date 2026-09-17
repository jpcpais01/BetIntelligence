import { privateKeyToAccount } from "viem/accounts";
import { isAddress, isHex, type Address } from "viem";
import { encryptSecret, decryptSecret, type EncryptedSecret } from "./crypto";

// A real-money order's maker is either the trading EOA itself (a browser wallet like MetaMask) or
// a Polymarket-managed proxy contract that EOA controls (email/Magic login, or an explicit Gnosis
// Safe) — matches @polymarket/clob-client's own SignatureType enum values exactly, so this never
// needs its own separate mapping.
export const SIGNATURE_TYPES = [
  { value: 0, label: "Browser wallet", hint: "MetaMask, Coinbase Wallet, or similar — connected directly to Polymarket" },
  { value: 1, label: "Email / Magic login", hint: "Signed up on Polymarket with just an email address" },
  { value: 2, label: "Gnosis Safe", hint: "An explicit Polymarket Safe wallet" },
] as const;

export type SignatureTypeValue = (typeof SIGNATURE_TYPES)[number]["value"];

// Everything here is safe to store in plaintext — a public address and which of the three known
// signing setups it uses. The one secret (the private key) is always stored separately, encrypted,
// and only this metadata plus the ciphertext ever touch localStorage.
export interface StoredWalletMeta {
  address: Address;
  signatureType: SignatureTypeValue;
  // Polymarket's own "Profile Address" — the maker/proxy the order's funds actually come from.
  // Equal to `address` for a browser wallet (signatureType 0); a separate proxy/Safe address the
  // user copies from their Polymarket profile for the other two.
  funder: Address;
}

interface StoredWalletRecord extends StoredWalletMeta {
  encrypted: EncryptedSecret;
}

const STORAGE_KEY = "betintelligence.realWallet.v1";

function readRecord(): StoredWalletRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.encrypted || !parsed.address) return null;
    return parsed as StoredWalletRecord;
  } catch {
    return null;
  }
}

export function hasStoredWallet(): boolean {
  return readRecord() !== null;
}

// Public metadata only — never touches the encrypted key, so this is safe to read at any time
// (e.g. to show "Connected: 0xAB12...", or the address/signature type on an unlock prompt) without
// asking for the passphrase first.
export function loadStoredWalletMeta(): StoredWalletMeta | null {
  const record = readRecord();
  if (!record) return null;
  return { address: record.address, signatureType: record.signatureType, funder: record.funder };
}

export function clearStoredWallet(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best effort only.
  }
}

export class InvalidPrivateKeyError extends Error {
  constructor() {
    super("That doesn't look like a valid private key (expected 0x followed by 64 hex characters).");
    this.name = "InvalidPrivateKeyError";
  }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("Wrong passphrase.");
    this.name = "WrongPassphraseError";
  }
}

export class NoStoredWalletError extends Error {
  constructor() {
    super("No wallet is connected yet.");
    this.name = "NoStoredWalletError";
  }
}

function normalizePrivateKey(input: string): `0x${string}` {
  const trimmed = input.trim();
  const withPrefix = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed : `0x${trimmed}`;
  if (!isHex(withPrefix) || withPrefix.length !== 66) throw new InvalidPrivateKeyError();
  return withPrefix.toLowerCase() as `0x${string}`;
}

// Derives the wallet's own address from a raw private key — used both to show the user which
// address they're about to connect (so they can confirm it matches their Polymarket profile
// before committing) and, for a browser-wallet signup (signatureType 0), as the funder address
// itself when none is given.
export function addressFromPrivateKey(privateKeyInput: string): Address {
  const key = normalizePrivateKey(privateKeyInput);
  return privateKeyToAccount(key).address;
}

// Encrypts and stores a new wallet, replacing any previous one. `funder` defaults to the derived
// address itself (correct for signatureType 0); callers must supply it explicitly for the other
// two signature types, where it's a different address entirely.
export async function saveWallet(params: {
  privateKeyInput: string;
  passphrase: string;
  signatureType: SignatureTypeValue;
  funder?: string;
}): Promise<StoredWalletMeta> {
  const privateKey = normalizePrivateKey(params.privateKeyInput);
  const address = privateKeyToAccount(privateKey).address;
  const funder = (params.funder?.trim() || address) as string;
  if (!isAddress(funder)) throw new Error("That funder/profile address doesn't look valid.");

  const encrypted = await encryptSecret(privateKey, params.passphrase);
  const meta: StoredWalletMeta = { address, signatureType: params.signatureType, funder: funder as Address };
  const record: StoredWalletRecord = { ...meta, encrypted };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  }
  return meta;
}

// Decrypts the stored private key for THIS session only — callers hold the result in memory (a
// React ref/state, never persisted) for as long as Real mode stays unlocked, and it's gone again
// on refresh or an explicit Lock. Throws WrongPassphraseError on a bad passphrase (AES-GCM's own
// auth-tag check fails) and NoStoredWalletError if nothing is connected at all.
export async function unlockWallet(passphrase: string): Promise<{ privateKey: `0x${string}`; meta: StoredWalletMeta }> {
  const record = readRecord();
  if (!record) throw new NoStoredWalletError();
  let privateKey: string;
  try {
    privateKey = await decryptSecret(record.encrypted, passphrase);
  } catch {
    throw new WrongPassphraseError();
  }
  const meta: StoredWalletMeta = { address: record.address, signatureType: record.signatureType, funder: record.funder };
  return { privateKey: privateKey as `0x${string}`, meta };
}

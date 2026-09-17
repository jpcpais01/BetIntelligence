// Encrypts the one genuinely sensitive secret in the real-money feature — a Polymarket trading
// wallet's private key — for storage in this browser's own localStorage. Nothing here ever talks
// to a server: this app's backend and Firestore never see the key, the passphrase, or the
// decrypted result, in plaintext or otherwise. Pure Web Crypto (available as a global in both the
// browser and Node 19+, which is what lets this run under the selftest suite without a DOM).
//
// AES-256-GCM with a PBKDF2-derived key (210,000 rounds, SHA-256 — OWASP's 2023 minimum for
// PBKDF2-HMAC-SHA256) rather than using the passphrase as a key directly, so a short/weak
// passphrase still costs real work to brute-force offline. GCM's own authentication tag is what
// makes a wrong passphrase fail loudly (decrypt() below throws) instead of silently returning
// garbage bytes that would then get submitted as a real private key.
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedSecret {
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// TS's DOM lib types WebCrypto's BufferSource as backed by a plain ArrayBuffer specifically, which
// a freshly-constructed Uint8Array's own inferred type (ArrayBufferLike, since TS can't statically
// rule out SharedArrayBuffer) doesn't satisfy — every Uint8Array actually built in this file always
// has a real ArrayBuffer behind it, so this cast is just narrowing back to what's already true.
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: asBufferSource(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptSecret(plaintext: string, passphrase: string): Promise<EncryptedSecret> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(new TextEncoder().encode(plaintext))
  );
  return {
    saltB64: toBase64(salt),
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(new Uint8Array(ciphertext)),
  };
}

// Throws (DOMException, name "OperationError") on a wrong passphrase — GCM's own auth tag check
// fails rather than returning decrypted-looking-but-wrong bytes. Callers should treat any throw
// here as "wrong passphrase", not attempt to recover partial output.
export async function decryptSecret(encrypted: EncryptedSecret, passphrase: string): Promise<string> {
  const salt = fromBase64(encrypted.saltB64);
  const iv = fromBase64(encrypted.ivB64);
  const key = await deriveKey(passphrase, salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(iv) },
    key,
    asBufferSource(fromBase64(encrypted.ciphertextB64))
  );
  return new TextDecoder().decode(plainBuf);
}

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

// A plain HMAC-signed cookie rather than a JWT library — this app needs exactly one claim (which
// username) and one property (unforgeable, since nothing here trusts client input for who's
// logged in), which crypto.createHmac already gives without adding a JWT dependency's much larger
// surface (algorithm negotiation, "alg: none" class bugs, etc.) for a feature this small.
const COOKIE_NAME = "bi_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface SessionPayload {
  u: string; // username, already normalized (lowercase) — see lib/auth/users.ts
  exp: number; // epoch ms
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured. Generate one with `openssl rand -base64 32` and set it in your environment.");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function createSessionToken(username: string): string {
  const payload: SessionPayload = { u: username, exp: Date.now() + SESSION_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

// Verifies both the signature (so a token can't be forged or edited client-side) and expiry.
// Returns the username on success, null on anything else — a malformed token, a bad signature, or
// an expired one are all just "not logged in", never a thrown error a caller has to remember to
// catch.
export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payloadB64 = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = sign(payloadB64);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.u !== "string" || typeof payload.exp !== "number") return null;
    if (Date.now() > payload.exp) return null;
    return payload.u;
  } catch {
    return null;
  }
}

// Called from a Route Handler (signup/login) after issuing a new session — httpOnly so client JS
// can never read or exfiltrate it, sameSite=lax so it still rides along on a same-site top-level
// navigation but never on a cross-site request, secure outside local dev where there's no HTTPS to
// require.
export async function setSessionCookie(username: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, createSessionToken(username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// The one thing every authenticated Route Handler needs: who's making this request, or null if
// no one's logged in (or their session expired) — never throws, so a handler can just check for
// null and return 401 rather than wrapping every call in try/catch.
export async function getSessionUsername(): Promise<string | null> {
  const store = await cookies();
  return verifySessionToken(store.get(COOKIE_NAME)?.value);
}

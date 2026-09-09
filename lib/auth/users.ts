import { getDb } from "../firebaseAdmin";
import { hashPassword, verifyPassword } from "./passwords";

const USERS_COLLECTION = "users";
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,24}$/;
const MIN_PASSWORD_LENGTH = 8;

// The doc id: lowercased so "Alice" and "alice" collide (one account, not two silently-separate
// ones a user would find genuinely confusing) — trimmed since leading/trailing whitespace from a
// pasted username is a real, easy-to-hit mistake, not a meaningfully different identity.
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function usernameError(username: string): string | null {
  if (!USERNAME_PATTERN.test(username.trim())) {
    return "Username must be 3-24 characters: letters, numbers, underscore, dot, or hyphen only.";
  }
  return null;
}

export function passwordError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

interface UserDoc {
  username: string; // original casing, for display
  passwordHash: string;
  createdAt: string;
}

// Throws a plain Error with a message safe to show the user directly (never a raw Firestore
// error) — "USERNAME_TAKEN" is the one case a caller needs to distinguish programmatically rather
// than just relaying the message, since it changes what the signup form should show/focus.
export async function createUser(username: string, password: string): Promise<{ username: string }> {
  const id = normalizeUsername(username);
  const doc: UserDoc = { username: username.trim(), passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };

  try {
    // .create() (not .set()) is what makes this atomic: it fails with ALREADY_EXISTS if the doc
    // is already there, rather than a set()+get() race where two signups for the same username at
    // the same instant could both "succeed", the second silently overwriting the first's account.
    await getDb().collection(USERS_COLLECTION).doc(id).create(doc);
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 6 /* ALREADY_EXISTS */) {
      const e = new Error("USERNAME_TAKEN");
      throw e;
    }
    throw err;
  }

  return { username: doc.username };
}

// null on ANY failure to authenticate — wrong username, wrong password, or a genuinely missing
// account all read identically to the caller, deliberately: distinguishing "no such user" from
// "wrong password" in the response is exactly what lets an attacker enumerate real usernames.
export async function verifyUserCredentials(username: string, password: string): Promise<{ username: string } | null> {
  const id = normalizeUsername(username);
  const snap = await getDb().collection(USERS_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const doc = snap.data() as UserDoc;
  const ok = await verifyPassword(password, doc.passwordHash);
  return ok ? { username: doc.username } : null;
}

export async function userExists(username: string): Promise<boolean> {
  const id = normalizeUsername(username);
  const snap = await getDb().collection(USERS_COLLECTION).doc(id).get();
  return snap.exists;
}

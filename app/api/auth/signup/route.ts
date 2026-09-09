import { NextResponse } from "next/server";
import { createUser, usernameError, passwordError } from "@/lib/auth/users";
import { setSessionCookie } from "@/lib/auth/session";
import { importLocalData } from "@/lib/auth/migrate";
import { MIGRATABLE_KEYS, type MigratableKey } from "@/lib/auth/migratableKeys";

export const maxDuration = 30;

interface SignupBody {
  username?: unknown;
  password?: unknown;
  // The current browser's localStorage snapshot (lib/auth/localSnapshot.ts), offered once at
  // signup time — optional, since a brand-new browser profile has nothing to bring over.
  snapshot?: unknown;
}

function parseSnapshot(raw: unknown): Partial<Record<MigratableKey, unknown>> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<MigratableKey, unknown>> = {};
  for (const key of Object.keys(MIGRATABLE_KEYS) as MigratableKey[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SignupBody;
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";

    const usernameErr = usernameError(username);
    if (usernameErr) return NextResponse.json({ error: usernameErr }, { status: 400 });
    const passwordErr = passwordError(password);
    if (passwordErr) return NextResponse.json({ error: passwordErr }, { status: 400 });

    let created: { username: string };
    try {
      created = await createUser(username, password);
    } catch (err) {
      if (err instanceof Error && err.message === "USERNAME_TAKEN") {
        return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
      }
      throw err;
    }

    const snapshot = parseSnapshot(body.snapshot);
    const { importedKeys } =
      Object.keys(snapshot).length > 0 ? await importLocalData(created.username, snapshot) : { importedKeys: [] };

    await setSessionCookie(created.username);
    return NextResponse.json({ username: created.username, importedKeys });
  } catch (err) {
    console.error("POST /api/auth/signup failed", err);
    return NextResponse.json({ error: "Could not create your account. Try again in a moment." }, { status: 500 });
  }
}

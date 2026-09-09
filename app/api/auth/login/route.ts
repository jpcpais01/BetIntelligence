import { NextResponse } from "next/server";
import { verifyUserCredentials } from "@/lib/auth/users";
import { setSessionCookie } from "@/lib/auth/session";

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = typeof body?.username === "string" ? body.username : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!username || !password) {
      return NextResponse.json({ error: "Enter a username and password." }, { status: 400 });
    }

    const user = await verifyUserCredentials(username, password);
    // Deliberately the same message for "no such user" and "wrong password" — see
    // lib/auth/users.ts's verifyUserCredentials for why distinguishing them here would let an
    // attacker enumerate real usernames.
    if (!user) {
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }

    await setSessionCookie(user.username);
    return NextResponse.json({ username: user.username });
  } catch (err) {
    console.error("POST /api/auth/login failed", err);
    return NextResponse.json({ error: "Could not log you in. Try again in a moment." }, { status: 500 });
  }
}

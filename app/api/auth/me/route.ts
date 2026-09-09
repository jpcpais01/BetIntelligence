import { NextResponse } from "next/server";
import { getSessionUsername } from "@/lib/auth/session";

export async function GET() {
  const username = await getSessionUsername();
  return NextResponse.json({ username });
}

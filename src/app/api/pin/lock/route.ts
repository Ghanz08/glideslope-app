import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { UNLOCK_COOKIE } from "@/lib/server/pin";

export async function POST() {
  (await cookies()).delete(UNLOCK_COOKIE);
  return NextResponse.json({ ok: true });
}

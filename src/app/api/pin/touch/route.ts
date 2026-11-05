import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getGate } from "@/lib/server/owner";
import { makeUnlockToken, UNLOCK_COOKIE } from "@/lib/server/pin";

// Extends the unlock cookie while the owner is active (idle timeout is enforced server-side too).
export async function POST() {
  const gate = await getGate();
  if (gate.state !== "ok") return NextResponse.json({ ok: false }, { status: 403 });
  if (gate.settings.pin_enabled) {
    const { value, maxAge } = makeUnlockToken(gate.userId, gate.settings.idle_timeout_minutes);
    (await cookies()).set(UNLOCK_COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge, path: "/" });
  }
  return NextResponse.json({ ok: true });
}

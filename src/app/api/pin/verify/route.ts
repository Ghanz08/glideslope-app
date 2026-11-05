import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/server/supabase";
import { errorResponse } from "@/lib/server/errors";
import { makeUnlockToken, PIN_RE, UNLOCK_COOKIE, verifyPin } from "@/lib/server/pin";

const MAX_FAILS = 5;

// API-02: PIN is verified on the server; 5 wrong PINs end the session.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!PIN_RE.test(pin)) return errorResponse(422, "VALIDASI", "PIN harus 6 angka.", { pin: "PIN harus 6 angka." });

  const s = await createClient();
  const { data: claims } = await s.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return errorResponse(401, "TANPA_SESI", "Silakan masuk dulu.");
  if (claims.claims.aal !== "aal2") return errorResponse(403, "BUTUH_KODE", "Masukkan kode autentikator dulu.");

  const { data: st, error } = await s
    .from("app_settings")
    .select("pin_hash, pin_salt, pin_iterations, pin_failed_attempts, idle_timeout_minutes")
    .single();
  if (error || !st) return errorResponse(503, "TIDAK_TERJANGKAU", "Tidak bisa memeriksa PIN. Periksa koneksi lalu coba lagi.");
  if (!st.pin_hash) return NextResponse.json({ ok: true });

  if (verifyPin(pin, st.pin_hash, st.pin_salt, st.pin_iterations)) {
    await s.from("app_settings").update({ pin_failed_attempts: 0 }).eq("user_id", uid);
    const { value, maxAge } = makeUnlockToken(uid, st.idle_timeout_minutes);
    (await cookies()).set(UNLOCK_COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge, path: "/" });
    return NextResponse.json({ ok: true });
  }

  const fails = st.pin_failed_attempts + 1;
  if (fails >= MAX_FAILS) {
    await s.from("app_settings").update({ pin_failed_attempts: 0 }).eq("user_id", uid);
    await s.auth.signOut();
    (await cookies()).delete(UNLOCK_COOKIE);
    return errorResponse(401, "SESI_BERAKHIR", "PIN salah 5 kali. Masuk ulang dengan kode autentikator.");
  }
  await s.from("app_settings").update({ pin_failed_attempts: fails }).eq("user_id", uid);
  return errorResponse(401, "PIN_SALAH", `PIN salah. Sisa ${MAX_FAILS - fails} percobaan.`);
}

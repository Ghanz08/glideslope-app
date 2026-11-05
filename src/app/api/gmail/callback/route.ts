import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ownerOrError } from "@/lib/server/owner";
import { errorResponse } from "@/lib/server/errors";
import { safeEqual } from "@/lib/server/pin";
import { createAdminClient } from "@/lib/server/supabase";
import { getProfileEmail } from "@/lib/ingest/gmail";

// API-13. The refresh token goes straight to Vault; it is never logged or returned.
export async function GET(req: NextRequest) {
  const o = await ownerOrError();
  if (!o.ok) return NextResponse.json(o.error, { status: o.status });
  const p = req.nextUrl.searchParams;
  const base = process.env.APP_BASE_URL ?? req.nextUrl.origin;
  const jar = await cookies();
  const expected = jar.get("gs_oauth_state")?.value;
  jar.delete({ name: "gs_oauth_state", path: "/api/gmail" });
  if (p.get("error")) return NextResponse.redirect(`${base}/sumber?gmail=ditolak`, 302);
  if (!safeEqual(p.get("state"), expected)) return errorResponse(400, "STATE_SALAH", "Permintaan tidak valid. Mulai lagi dari tombol Hubungkan Gmail.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: p.get("code") ?? "",
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "",
      grant_type: "authorization_code",
    }),
  }).catch(() => null);
  const tokens = res?.ok ? ((await res.json()) as { refresh_token?: string; access_token?: string }) : null;
  if (!tokens?.refresh_token || !tokens.access_token) return errorResponse(502, "GOOGLE_GAGAL", "Google belum memberi akses. Coba hubungkan lagi.");
  const email = await getProfileEmail(fetch, tokens.access_token).catch(() => null);

  const admin = createAdminClient();
  const { error } = await admin.rpc("store_gmail_secret", { p_uid: o.userId, p_token: tokens.refresh_token, p_email: email });
  if (error) return errorResponse(500, "GALAT", "Koneksi Gmail belum tersimpan. Coba lagi.");
  if (o.settings.onboarding_step === 4) await o.supabase.from("app_settings").update({ onboarding_step: 5 }).eq("user_id", o.userId);
  return NextResponse.redirect(`${base}/sumber?gmail=terhubung`, 302);
}

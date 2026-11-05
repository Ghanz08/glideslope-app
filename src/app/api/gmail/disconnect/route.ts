import { NextResponse } from "next/server";
import { ownerOrError } from "@/lib/server/owner";
import { createAdminClient } from "@/lib/server/supabase";

// API-14: revoke at Google, delete the Vault secret, stop polling. Existing transactions stay.
export async function POST() {
  const o = await ownerOrError();
  if (!o.ok) return NextResponse.json(o.error, { status: o.status });
  const { data: token } = await createAdminClient().rpc("take_gmail_secret", { p_uid: o.userId });
  if (token) {
    const r = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(String(token))}`, { method: "POST" }).catch(() => null);
    if (!r?.ok) await o.supabase.from("integrations").update({ last_error: "Pencabutan di Google gagal; rahasia sudah dihapus." }).eq("user_id", o.userId);
  }
  return NextResponse.json({ ok: true });
}

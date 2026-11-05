import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/server/supabase";
import { errorResponse } from "@/lib/server/errors";
import { safeEqual } from "@/lib/server/pin";

// API-42: Vercel Cron once a day keeps the free Supabase project from pausing.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!safeEqual(auth, process.env.CRON_SECRET)) return errorResponse(401, "RAHASIA_SALAH", "Rahasia cron salah.");
  const { error } = await createAdminClient().from("app_settings").select("user_id", { head: true, count: "exact" });
  if (error) return errorResponse(503, "DB_TIDAK_TERJANGKAU", "Basis data tidak terjangkau.");
  return NextResponse.json({ ok: true });
}

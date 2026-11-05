import { NextResponse } from "next/server";
import { ownerOrError, hitRateLimit } from "@/lib/server/owner";
import { errorResponse } from "@/lib/server/errors";
import { verifyPin } from "@/lib/server/pin";
import { buildExport, EXPORT_TABLES } from "@/lib/core/export";
import { appSlug } from "@/lib/env";
import { now, todayWib } from "@/lib/core/dates";

// API-40: re-verify with PIN (or TOTP when no PIN is set) before producing the archive.
export async function POST(req: Request) {
  const o = await ownerOrError();
  if (!o.ok) return NextResponse.json(o.error, { status: o.status });
  const body = (await req.json().catch(() => ({}))) as { pin?: string; code?: string };
  const s = o.supabase;

  let verified = false;
  if (o.settings.pin_enabled && body.pin) {
    const { data } = await s.from("app_settings").select("pin_hash, pin_salt, pin_iterations").single();
    verified = !!data?.pin_hash && verifyPin(body.pin, data.pin_hash, data.pin_salt, data.pin_iterations);
  } else if (body.code && /^\d{6}$/.test(body.code)) {
    const { data } = await s.auth.mfa.listFactors();
    const f = data?.totp?.find((x) => x.status === "verified");
    verified = !!f && !(await s.auth.mfa.challengeAndVerify({ factorId: f.id, code: body.code })).error;
  }
  if (!verified) return errorResponse(403, "VERIFIKASI_ULANG", "Verifikasi ulang gagal. Masukkan PIN atau kode autentikator yang benar.");

  const limit = await hitRateLimit(`export:${o.userId}`, 3600, 3);
  if (!limit.allowed) return errorResponse(429, "TERLALU_SERING", "Ekspor dibatasi 3 kali per jam. Coba lagi nanti.");

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of EXPORT_TABLES) {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await s.from(t).select("*").range(from, from + 999);
      if (error) return errorResponse(500, "GALAT", "Ekspor gagal dibuat. Coba lagi.");
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    tables[t] = rows;
  }
  const { filename, bytes } = buildExport(tables, appSlug(), todayWib(now()));
  await s.from("app_settings").update({ last_export_at: new Date().toISOString() }).eq("user_id", o.userId);
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" },
  });
}

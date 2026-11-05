import { NextResponse } from "next/server";
import { hitRateLimit } from "@/lib/server/owner";
import { errorResponse } from "@/lib/server/errors";
import { serverDb } from "@/lib/server/sql";
import { checkWebhook, webhookExternalId, WEBHOOK_MAX_BYTES } from "@/lib/ingest/webhook";
import { ingestWebhook } from "@/lib/ingest/pipeline";

// API-36: phone-notification forwarder. Same path as email: parser first, then the LLM queue.
export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  const secret = req.headers.get("x-webhook-secret");
  if (len > WEBHOOK_MAX_BYTES * 2) return errorResponse(413, "TERLALU_BESAR", "Badan lebih dari 8 KB.");
  const raw = await req.text();
  const check = await checkWebhook(secret, raw, process.env.WEBHOOK_SECRET, new Date());
  if (!check.ok) return errorResponse(check.status, check.code, check.message);

  const limit = await hitRateLimit("webhook", 60, 60);
  if (!limit.allowed) return errorResponse(429, "TERLALU_SERING", "Lebih dari 60 permintaan per menit.");

  const db = serverDb();
  if (!db) return errorResponse(503, "DB_TIDAK_DIATUR", "SUPABASE_DB_URL belum diisi.");
  const [owner] = await db.q(`select user_id from app_settings order by created_at limit 1`);
  if (!owner) return errorResponse(503, "BELUM_ADA_PEMILIK", "Belum ada akun pemilik.");
  await ingestWebhook(db, owner.user_id, check.body, await webhookExternalId(check.body.text, check.body.posted_at), new Date());
  return NextResponse.json({ accepted: true }, { status: 202 });
}

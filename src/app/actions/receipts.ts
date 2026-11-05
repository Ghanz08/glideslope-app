"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hitRateLimit, ownerOrError } from "@/lib/server/owner";
import { apiError, dbError, fieldErrors, type ActionResult } from "@/lib/server/errors";
import { resolveMerchant } from "@/lib/server/merchants";
import type { Supa } from "@/lib/server/supabase";
import { assessConfidence, receiptScore, validateReceipt, type ReceiptProblem } from "@/lib/core/domain";
import { chooseReceiptMatch, extractReceipt } from "@/lib/ingest/receipt";
import { llmConfigFromEnv } from "@/lib/ingest/llm";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const done = () => revalidatePath("/", "layout");

/** API-31 upload: the client already resized the photo (≤ 1568 px, JPEG 0,85, < 5 MB). */
export async function uploadReceipt(form: FormData): Promise<ActionResult<{ id: string; status: string }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const file = form.get("file");
  if (!(file instanceof File) || !TYPES.includes(file.type)) return apiError("FORMAT", "Pilih foto JPEG, PNG, atau WebP.", { file: "Pilih foto JPEG, PNG, atau WebP." });
  if (file.size >= 5 * 1024 * 1024) return apiError("TERLALU_BESAR", "Foto masih lebih dari 5 MB setelah dikecilkan.", { file: "Foto terlalu besar." });
  const limit = await hitRateLimit(`receipt:${o.userId}`, 3600, 20);
  if (!limit.allowed) return apiError("TERLALU_SERING", "Unggah nota dibatasi 20 per jam. Coba lagi nanti.");

  const { data: r, error } = await o.supabase.from("receipts").insert({ status: "uploaded" }).select("id").single();
  if (error) return dbError(error);
  const path = `${o.userId}/${r.id}.${file.type.split("/")[1]}`;
  const up = await o.supabase.storage.from("receipts").upload(path, file, { contentType: file.type, upsert: true });
  if (up.error) return apiError("UNGGAH_GAGAL", "Foto belum terunggah. Periksa koneksi lalu coba lagi.");
  await o.supabase.from("receipts").update({ image_path: path }).eq("id", r.id);
  const status = await runExtraction(o.supabase, r.id, o.settings);
  done();
  return { ok: true, id: r.id, status };
}

async function runExtraction(s: Supa, id: string, settings: { llm_enabled: boolean; redaction_terms: string[] }): Promise<string> {
  // F-09: the photo goes only to our own OCR service; the LLM (when on) sees redacted OCR text, never the image
  const { data: rec } = await s.from("receipts").select("image_path").eq("id", id).single();
  const img = rec?.image_path ? await s.storage.from("receipts").download(rec.image_path) : null;
  if (!img?.data || !process.env.OCR_URL) {
    await s.from("receipts").update({ status: "gagal" }).eq("id", id);
    return "gagal";
  }
  const out = await extractReceipt({ url: process.env.OCR_URL, token: process.env.OCR_TOKEN }, img.data, {
    llm: llmConfigFromEnv(process.env), enabled: settings.llm_enabled, redactionTerms: settings.redaction_terms,
  });
  if (out.status === "gagal") {
    await s.from("receipts").update({ status: "gagal" }).eq("id", id);
    return "gagal";
  }
  await saveNumbers(s, id, out.data, out.status, out.model_used);
  return out.status;
}

async function saveNumbers(
  s: Supa,
  id: string,
  d: { merchant_name: string | null; occurred_at: string | null; items: { name: string; quantity: number; unit_price: number; line_total: number }[]; subtotal: number | null; service_charge: number; tax_amount: number; tax_rate_pct: number | null; discount: number; rounding: number; total: number | null; payment_method: string | null },
  status: string,
  model?: string,
) {
  await s.from("receipt_items").delete().eq("receipt_id", id);
  if (d.items.length) {
    const ins = await s.from("receipt_items").insert(d.items.map((it, i) => ({ receipt_id: id, position: i + 1, ...it })));
    if (ins.error) throw new Error(`receipt_items: ${ins.error.message}`);
  }
  // only real columns: extraction results carry helper fields (e.g. currency_ok) that would make the update fail
  const numbers = {
    merchant_name: d.merchant_name, occurred_at: d.occurred_at, subtotal: d.subtotal, service_charge: d.service_charge, tax_amount: d.tax_amount,
    tax_rate_pct: d.tax_rate_pct, discount: d.discount, rounding: d.rounding, total: d.total, payment_method: d.payment_method,
  };
  const up = await s.from("receipts").update({ ...numbers, status, validation_ok: status === "extracted", ...(model ? { model_used: model } : {}) }).eq("id", id);
  if (up.error) throw new Error(`receipts: ${up.error.message}`);
}

export async function retryExtraction(id: string): Promise<ActionResult<{ status: string }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  await o.supabase.from("receipts").update({ status: "uploaded" }).eq("id", id).eq("status", "gagal");
  const status = await runExtraction(o.supabase, id, o.settings);
  done();
  return { ok: true, status };
}

export async function createManualReceipt(): Promise<ActionResult<{ id: string }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { data, error } = await o.supabase.from("receipts").insert({ status: "perlu_koreksi" }).select("id").single();
  if (error) return dbError(error);
  return { ok: true, id: data.id };
}

const money = z.number().int().min(0);
const EditSchema = z.object({
  merchant_name: z.string().trim().max(120).nullable(),
  occurred_at: z.string().nullable(),
  items: z.array(z.object({ name: z.string().trim().min(1, "Nama item wajib diisi.").max(120), quantity: z.number().positive().refine((q) => Math.round(q * 100) === q * 100, "Maksimal 2 desimal."), unit_price: money, line_total: money })).max(100),
  subtotal: money.nullable(),
  service_charge: money,
  tax_amount: money,
  tax_rate_pct: z.number().min(0).max(100).nullable(),
  discount: money,
  rounding: z.number().int(),
  total: money.nullable(),
  payment_method: z.string().max(60).nullable(),
});

/** Owner edits; validation is recomputed on every save (Table 5.4-I). */
export async function saveReceiptEdits(id: string, input: z.input<typeof EditSchema>): Promise<ActionResult<{ problems: ReceiptProblem[] }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const p = EditSchema.safeParse(input);
  if (!p.success) return apiError("VALIDASI", "Periksa isian.", fieldErrors(p.error.issues));
  const { data: cur } = await o.supabase.from("receipts").select("status").eq("id", id).maybeSingle();
  if (!cur) return apiError("TIDAK_DITEMUKAN", "Nota tidak ditemukan.");
  if (cur.status === "confirmed") return apiError("SUDAH_DIKONFIRMASI", "Nota sudah dikonfirmasi.");
  if ((p.data.discount ?? 0) > (p.data.subtotal ?? 0)) return apiError("VALIDASI", "Periksa isian.", { discount: "Diskon tidak boleh lebih besar dari subtotal." });
  const v = validateReceipt(p.data);
  await saveNumbers(o.supabase, id, { ...p.data, occurred_at: p.data.occurred_at ? new Date(p.data.occurred_at).toISOString() : null }, v.ok ? "extracted" : "perlu_koreksi");
  done();
  return { ok: true, problems: v.problems };
}

/** Confirm (never automatic), then F-09.3: propose a link to a matching transaction, or create a "hanya_nota" one. */
export async function confirmReceipt(id: string, accountId: string, categoryId: string | null): Promise<ActionResult<{ matched: boolean }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const s = o.supabase;
  const { data: r } = await s.from("receipts").select("id, status, merchant_name, occurred_at, total, created_at, validation_ok").eq("id", id).maybeSingle();
  if (!r) return apiError("TIDAK_DITEMUKAN", "Nota tidak ditemukan.");
  if (r.status !== "extracted" || !r.validation_ok || !r.total) return apiError("HITUNGAN_TIDAK_COCOK", "Hitungan nota belum cocok. Perbaiki angka yang ditandai dulu.");
  const { error } = await s.from("receipts").update({ status: "confirmed" }).eq("id", id);
  if (error) return dbError(error);

  const center = Date.parse(r.occurred_at ?? r.created_at);
  const { data: cands } = await s
    .from("transactions")
    .select("id, amount, occurred_at, merchant_raw, merchants(display_name), transaction_evidence(role)")
    .eq("kind", "expense")
    .eq("direction", "out")
    .eq("amount", r.total)
    .is("deleted_at", null)
    .neq("status", "ignored")
    .gte("occurred_at", new Date(center - 2 * 86400_000).toISOString())
    .lte("occurred_at", new Date(center + 2 * 86400_000).toISOString());
  const scored = [];
  for (const t of (cands ?? []) as unknown as { id: string; amount: number; occurred_at: string; merchant_raw: string | null; merchants: { display_name: string } | null; transaction_evidence: { role: string }[] }[]) {
    if (t.transaction_evidence.some((e) => e.role === "receipt")) continue;
    const score = receiptScore({ total: Number(r.total), occurred_at: r.occurred_at, merchant: r.merchant_name }, { amount: Number(t.amount), occurred_at: t.occurred_at, merchant: t.merchants?.display_name ?? t.merchant_raw });
    if (score == null) continue;
    const { data: rej } = await s.from("match_proposals").select("id").eq("type", "receipt_link").eq("status", "rejected").eq("transaction_id", t.id).eq("receipt_id", id).maybeSingle();
    if (rej) continue;
    const { data: others } = await s.from("match_proposals").select("score").eq("type", "receipt_link").eq("status", "open").eq("transaction_id", t.id);
    const best = others?.length ? Math.max(...others.map((x) => Number(x.score))) : null;
    scored.push({ txId: t.id, score, gapMs: Math.abs(Date.parse(t.occurred_at) - center), bestOtherScore: best });
  }
  const pick = chooseReceiptMatch(scored);
  if (pick) {
    await s.from("match_proposals").update({ status: "closed", resolved_at: new Date().toISOString() }).eq("type", "receipt_link").eq("status", "open").eq("transaction_id", pick.txId);
    const { error: e } = await s.from("match_proposals").insert({ type: "receipt_link", transaction_id: pick.txId, receipt_id: id, score: pick.score });
    if (e) return dbError(e);
    done();
    return { ok: true, matched: true };
  }

  const merchant = r.merchant_name ? await resolveMerchant(s, r.merchant_name, { create: true }) : null;
  const category = categoryId ?? merchant?.default_category_id ?? null;
  const verdict = assessConfidence({
    viaLlm: false, accountUnknown: false, amount: Number(r.total), threshold: o.settings.large_amount_threshold, duplicateSuspect: false,
    kindUnclear: false, receiptOnly: true, merchantHasDefaultCategory: !!category, merchantSkipReview: !!merchant?.skip_review, requiredFieldsComplete: true,
  });
  const { data: tx, error: e2 } = await s
    .from("transactions")
    .insert({
      account_id: accountId, direction: "out", amount: r.total, occurred_at: r.occurred_at ?? new Date().toISOString(), kind: "expense",
      category_id: category, merchant_id: merchant?.id ?? null, merchant_raw: r.merchant_name, status: verdict.status, review_reason: verdict.reason,
      confidence: verdict.confidence, source: "receipt", is_one_off: !!merchant?.default_one_off,
    })
    .select("id")
    .single();
  if (e2) return dbError(e2);
  await s.from("transaction_evidence").insert({ transaction_id: tx.id, role: "receipt", receipt_id: id, parsed_amount: r.total });
  await s.from("receipts").update({ linked_transaction_id: tx.id }).eq("id", id);
  done();
  return { ok: true, matched: false };
}

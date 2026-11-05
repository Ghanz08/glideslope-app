"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerOrError } from "@/lib/server/owner";
import { apiError, dbError, fieldErrors, type ActionResult } from "@/lib/server/errors";
import { PARSER_IDS } from "@/lib/core/parsers";

const SourceSchema = z.object({
  sender_address: z.string().trim().toLowerCase().refine((s) => /^[^\s@]+@[^\s@]+$/.test(s), "Alamat pengirim harus berisi @."),
  label: z.string().trim().min(1, "Label wajib diisi.").max(40, "Maksimal 40 karakter."),
  parser_id: z.enum(PARSER_IDS as [string, ...string[]]).nullable(),
  default_account_id: z.uuid().nullable(),
});

/** API-17 saveEmailSource. Senders without a parser are read by the LLM fallback. */
export async function saveEmailSource(input: z.input<typeof SourceSchema>): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const p = SourceSchema.safeParse(input);
  if (!p.success) return apiError("VALIDASI", "Periksa isian.", fieldErrors(p.error.issues));
  const { error } = await o.supabase.from("email_sources").insert(p.data);
  if (error?.code === "23505") return apiError("PENGIRIM_SUDAH_ADA", "Pengirim sudah ada.", { sender_address: "Pengirim sudah ada." });
  if (error) return dbError(error);
  revalidatePath("/sumber");
  return { ok: true };
}

export async function toggleEmailSource(id: string, enabled: boolean): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.from("email_sources").update({ enabled }).eq("id", id);
  if (error) return dbError(error);
  revalidatePath("/sumber");
  return { ok: true };
}

export async function retryUnreadable(eventId: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  if (!o.settings.llm_enabled) return apiError("LLM_MATI", "Nyalakan sakelar LLM di Pengaturan dulu.");
  const { data: ev } = await o.supabase.from("ingest_events").select("id, sender, subject, received_at, raw_text_redacted").eq("id", eventId).maybeSingle();
  if (!ev) return apiError("TIDAK_DITEMUKAN", "Email tidak ditemukan.");
  if (!ev.raw_text_redacted) return apiError("TEKS_KOSONG", "Teks email sudah dihapus setelah 90 hari. Catat manual saja.");
  const { error } = await o.supabase.from("llm_jobs").insert({
    kind: "parse_email",
    ref_id: ev.id,
    payload: { sender: ev.sender, subject: ev.subject, date: ev.received_at, text: ev.raw_text_redacted.slice(0, 6000), default_account_id: null },
  });
  if (error) return dbError(error);
  await o.supabase.from("ingest_events").update({ parse_status: "needs_llm" }).eq("id", eventId);
  revalidatePath("/sumber");
  return { ok: true };
}

export async function ignoreUnreadable(eventId: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.from("ingest_events").update({ parse_status: "ignored" }).eq("id", eventId);
  if (error) return dbError(error);
  revalidatePath("/sumber");
  return { ok: true };
}

/** API-18 */
export async function startBackfill(): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { data } = await o.supabase.from("integrations").select("status, backfill_state").eq("provider", "gmail").maybeSingle();
  if (data?.status !== "terhubung") return apiError("GMAIL_BELUM", "Hubungkan Gmail dulu.");
  if ((data.backfill_state as { status?: string } | null)?.status === "running") return apiError("IMPOR_BERJALAN", "Impor sedang berjalan.");
  const { error } = await o.supabase.from("integrations").update({ backfill_state: { status: "running" } }).eq("provider", "gmail");
  if (error) return dbError(error);
  revalidatePath("/sumber");
  return { ok: true };
}

export async function cancelBackfill(): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { data } = await o.supabase.from("integrations").select("backfill_state").eq("provider", "gmail").maybeSingle();
  const st = (data?.backfill_state ?? {}) as { total?: number; processed?: number };
  const { error } = await o.supabase.from("integrations").update({ backfill_state: { status: "cancelled", total: st.total ?? 0, processed: st.processed ?? 0 } }).eq("provider", "gmail");
  if (error) return dbError(error);
  revalidatePath("/sumber");
  return { ok: true };
}

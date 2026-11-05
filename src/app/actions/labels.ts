"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerOrError } from "@/lib/server/owner";
import { apiError, dbError, fieldErrors, type ActionResult } from "@/lib/server/errors";

const LabelSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Nama label wajib diisi.").max(40, "Maksimal 40 karakter."),
  auto_one_off: z.boolean(),
  target_amount: z.number().int("Target harus bilangan bulat.").min(1, "Target harus lebih dari 0.").max(999_999_999_999).nullable(),
});

/** F-08.4: create or edit a label. Turning on auto one-off marks every transaction already carrying it. */
export async function saveLabel(input: z.input<typeof LabelSchema>): Promise<ActionResult<{ id: string }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const p = LabelSchema.safeParse(input);
  if (!p.success) return apiError("VALIDASI", "Periksa isian.", fieldErrors(p.error.issues));
  const { id, ...v } = p.data;
  const r = id
    ? await o.supabase.from("labels").update(v).eq("id", id).select("id").single()
    : await o.supabase.from("labels").insert(v).select("id").single();
  if (r.error) return r.error.code === "23505" ? apiError("NAMA_SAMA", "Nama label sudah dipakai.", { name: "Nama label sudah dipakai." }) : dbError(r.error);
  if (v.auto_one_off) {
    const links = await o.supabase.from("transaction_labels").select("transaction_id").eq("label_id", r.data.id);
    const ids = (links.data ?? []).map((l) => l.transaction_id);
    if (ids.length) await o.supabase.from("transactions").update({ is_one_off: true }).in("id", ids).eq("is_one_off", false);
  }
  revalidatePath("/", "layout");
  return { ok: true, id: r.data.id };
}

/** Labels are archived, never deleted: their transactions keep the history. */
export async function archiveLabel(id: string, archive = true): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.from("labels").update({ archived_at: archive ? new Date().toISOString() : null }).eq("id", id);
  if (error) return error.code === "23505" ? apiError("NAMA_SAMA", "Ada label aktif dengan nama yang sama.") : dbError(error);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Replace a transaction's labels. A label marked "acara khusus" (auto_one_off) also marks the transaction one-off;
 * removing the label leaves that flag alone, since the owner may want to keep it.
 */
export async function setTransactionLabels(transactionId: string, labelIds: string[]): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const ids = z.array(z.uuid()).max(20).safeParse([...new Set(labelIds)]);
  if (!z.uuid().safeParse(transactionId).success || !ids.success) return apiError("VALIDASI", "Label tidak valid.");
  const cur = await o.supabase.from("transaction_labels").select("label_id").eq("transaction_id", transactionId);
  if (cur.error) return dbError(cur.error);
  const had = new Set(cur.data.map((r) => r.label_id as string));
  const removed = [...had].filter((x) => !ids.data.includes(x));
  const added = ids.data.filter((x) => !had.has(x));
  if (added.length) {
    const ins = await o.supabase.from("transaction_labels").insert(added.map((label_id) => ({ transaction_id: transactionId, label_id })));
    if (ins.error) return dbError(ins.error);
    const auto = await o.supabase.from("labels").select("id").in("id", added).eq("auto_one_off", true).limit(1);
    if (auto.data?.length) await o.supabase.from("transactions").update({ is_one_off: true }).eq("id", transactionId).eq("is_one_off", false);
  }
  if (removed.length) {
    const del = await o.supabase.from("transaction_labels").delete().eq("transaction_id", transactionId).in("label_id", removed);
    if (del.error) return dbError(del.error);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

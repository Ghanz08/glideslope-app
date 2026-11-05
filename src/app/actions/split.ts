"use server";
import { revalidatePath } from "next/cache";
import { ownerOrError } from "@/lib/server/owner";
import { apiError, dbError, type ActionResult } from "@/lib/server/errors";
import { allocateSplit, validateParticipants } from "@/lib/core/split";
import { now, todayWib, wibDate } from "@/lib/core/dates";

const done = () => revalidatePath("/", "layout");

/** Draft split from a receipt or a transaction (its linked receipt, or a one-line manual receipt). */
export async function createSplitFrom(src: { nota?: string; transaksi?: string }): Promise<ActionResult<{ id: string }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const s = o.supabase;
  let receiptId = src.nota ?? null;
  let txId: string | null = null;
  let title = "Bagi tagihan";
  let date = todayWib(now());
  if (src.transaksi) {
    const { data: t } = await s.from("transactions").select("id, amount, occurred_at, merchant_raw, kind, merchants(display_name), transaction_evidence(receipt_id)").eq("id", src.transaksi).is("deleted_at", null).maybeSingle();
    if (!t) return apiError("TIDAK_DITEMUKAN", "Transaksi tidak ditemukan.");
    if (t.kind !== "expense") return apiError("BUKAN_PENGELUARAN", "Hanya pengeluaran yang bisa dibagi.");
    txId = t.id;
    title = ((t.merchants as unknown as { display_name: string } | null)?.display_name ?? t.merchant_raw ?? title).slice(0, 60);
    date = wibDate(t.occurred_at);
    receiptId = (t.transaction_evidence as { receipt_id: string | null }[]).find((e) => e.receipt_id)?.receipt_id ?? null;
    if (!receiptId) {
      const { data: r, error } = await s.from("receipts").insert({ status: "confirmed", merchant_name: title, occurred_at: t.occurred_at, subtotal: t.amount, total: t.amount, validation_ok: true }).select("id").single();
      if (error) return dbError(error);
      await s.from("receipt_items").insert({ receipt_id: r.id, position: 1, name: title, quantity: 1, unit_price: t.amount, line_total: t.amount });
      receiptId = r.id;
    }
  }
  if (!receiptId) return apiError("TANPA_NOTA", "Pilih nota atau transaksi untuk dibagi.");
  const existing = await s.from("split_bills").select("id").eq("receipt_id", receiptId).maybeSingle();
  if (existing.data) return { ok: true, id: existing.data.id };
  const { data: r } = await s.from("receipts").select("merchant_name, occurred_at, total, linked_transaction_id, status").eq("id", receiptId).maybeSingle();
  if (!r?.total) return apiError("NOTA_BELUM_SIAP", "Lengkapi dan konfirmasi nota dulu.");
  const { data: sb, error } = await s
    .from("split_bills")
    .insert({ receipt_id: receiptId, transaction_id: txId ?? r.linked_transaction_id, title: (r.merchant_name ?? title).slice(0, 60), occurred_on: r.occurred_at ? wibDate(r.occurred_at) : date, total: r.total })
    .select("id")
    .single();
  if (error) return dbError(error);
  await s.from("split_participants").insert({ split_bill_id: sb.id, name: "Aku", is_owner: true, position: 1 });
  return { ok: true, id: sb.id };
}

export interface SplitInput {
  title: string;
  tax_base: "items_plus_service" | "items";
  participants: { name: string; phone_digits: string | null; is_owner: boolean }[];
  assignments: { item_id: string; participant: number; weight: number }[];
}

/** API-33 saveSplit: shares are recomputed on the server with Table 5.4-D. */
export async function saveSplit(id: string, input: SplitInput): Promise<ActionResult<{ sumOk: boolean; unassigned: string[] }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const s = o.supabase;
  const errs = validateParticipants(input.participants);
  if (!input.title.trim() || input.title.length > 60) errs.title = "Judul 1–60 karakter.";
  if (Object.keys(errs).length) return apiError("VALIDASI", Object.values(errs)[0], errs);
  const { data: sb } = await s.from("split_bills").select("id, status, total, receipts(service_charge, tax_amount, discount, rounding, receipt_items(id, name, line_total))").eq("id", id).maybeSingle();
  if (!sb) return apiError("TIDAK_DITEMUKAN", "Tagihan tidak ditemukan.");
  if (sb.status !== "draft") return apiError("SUDAH_DIBAGIKAN", "Tagihan ini sudah dibagikan.");
  const rec = sb.receipts as unknown as { service_charge: number; tax_amount: number; discount: number; rounding: number; receipt_items: { id: string; name: string; line_total: number }[] };
  const ps = input.participants.map((p, i) => ({ id: `p${i}`, name: p.name.trim(), is_owner: p.is_owner }));
  const result = allocateSplit(
    { total: Number(sb.total), service_charge: Number(rec.service_charge), tax_amount: Number(rec.tax_amount), discount: Number(rec.discount), rounding: Number(rec.rounding), tax_base: input.tax_base },
    rec.receipt_items.map((i) => ({ id: i.id, name: i.name, line_total: Number(i.line_total) })),
    ps,
    input.assignments.filter((a) => a.weight > 0).map((a) => ({ item_id: a.item_id, participant_id: `p${a.participant}`, weight: a.weight })),
  );
  await s.from("split_participants").delete().eq("split_bill_id", id);
  const { data: inserted, error } = await s
    .from("split_participants")
    .insert(input.participants.map((p, i) => ({ split_bill_id: id, name: p.name.trim(), phone_digits: p.phone_digits || null, is_owner: p.is_owner, position: i + 1, share_amount: result.shares[`p${i}`] ?? 0 })))
    .select("id, position");
  if (error) return dbError(error);
  const idAt = (i: number) => inserted!.find((x) => x.position === i + 1)!.id;
  const rows = input.assignments.filter((a) => a.weight > 0 && a.participant < input.participants.length).map((a) => ({ split_bill_id: id, receipt_item_id: a.item_id, participant_id: idAt(a.participant), weight: a.weight }));
  if (rows.length) {
    const r2 = await s.from("split_assignments").insert(rows);
    if (r2.error) return dbError(r2.error);
  }
  await s.from("split_bills").update({ title: input.title.trim(), tax_base: input.tax_base }).eq("id", id);
  revalidatePath(`/bagi/${id}`);
  return { ok: true, sumOk: result.sumOk, unassigned: result.unassigned };
}

/** API-33 shareSplit: status shared + one receivable per other participant (no message is sent automatically). */
export async function shareSplit(id: string, input: SplitInput): Promise<ActionResult> {
  const saved = await saveSplit(id, input);
  if ("error" in saved) return saved;
  if (!saved.sumOk) return apiError("JUMLAH_TIDAK_SAMA", saved.unassigned.length ? "Masih ada item yang belum ditugaskan." : "Jumlah semua bagian belum sama dengan total nota.");
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.rpc("rpc_share_split", { p_split: id });
  if (error) return dbError(error);
  done();
  return { ok: true };
}

export async function cancelSplit(id: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.rpc("rpc_cancel_split", { p_split: id });
  if (error) return dbError(error);
  done();
  return { ok: true };
}

/** API-34 recordRepayment ("Tandai lunas tunai" pays the remaining amount into the chosen account). */
export async function recordRepayment(receivableId: string, amount: number, accountId: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.rpc("rpc_record_repayment", { p_receivable: receivableId, p_amount: amount, p_account: accountId, p_at: new Date().toISOString() });
  if (error) return dbError(error);
  done();
  return { ok: true };
}

export async function writeOffReceivable(receivableId: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.rpc("rpc_write_off_receivable", { p_receivable: receivableId });
  if (error) return dbError(error);
  done();
  return { ok: true };
}

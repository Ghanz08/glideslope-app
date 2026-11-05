"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerOrError } from "@/lib/server/owner";
import { apiError, dbError, fieldErrors, type ActionResult } from "@/lib/server/errors";
import { resolveMerchant } from "@/lib/server/merchants";
import { MAX_TX_AMOUNT } from "@/lib/core/money";
import { now } from "@/lib/core/dates";
import { normalizeMerchant } from "@/lib/core/domain";
import { parseQuickAdd } from "@/lib/core/insights";

const amount = z.number().int("Jumlah harus bilangan bulat.").min(1, "Jumlah harus lebih dari 0.").max(MAX_TX_AMOUNT, "Maksimal Rp 999.999.999.");
const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Tanggal tidak valid.");
const notFuture = (s: string) => Date.parse(s) <= now().getTime() + 86400_000;

const TxSchema = z.object({
  client_id: z.uuid(),
  kind: z.enum(["expense", "income"]),
  amount,
  account_id: z.uuid({ message: "Pilih akun." }),
  category_id: z.uuid({ message: "Pilih kategori." }),
  merchant_raw: z.string().trim().max(200).nullable(),
  occurred_at: iso.refine(notFuture, "Tanggal tidak boleh lebih dari 1 hari ke depan."),
  note: z.string().trim().max(500).nullable(),
  is_one_off: z.boolean(),
  remember: z.boolean().default(true),
});

/** API-07 createTransaction — manual entries are confirmed immediately; client_id makes it idempotent. */
export async function createTransaction(input: z.input<typeof TxSchema>): Promise<ActionResult<{ id: string }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const p = TxSchema.safeParse(input);
  if (!p.success) return apiError("VALIDASI", "Periksa isian yang ditandai.", fieldErrors(p.error.issues));
  const v = p.data;
  const existing = await o.supabase.from("transactions").select("id").eq("client_id", v.client_id).maybeSingle();
  if (existing.data) return { ok: true, id: existing.data.id };

  const acc = await o.supabase.from("accounts").select("id, is_system").eq("id", v.account_id).is("archived_at", null).maybeSingle();
  if (!acc.data || acc.data.is_system) return apiError("TIDAK_DITEMUKAN", "Akun tidak ditemukan.", { account_id: "Pilih akun." });

  const merchant = v.merchant_raw ? await resolveMerchant(o.supabase, v.merchant_raw, { create: true }) : null;
  const { data, error } = await o.supabase
    .from("transactions")
    .insert({
      client_id: v.client_id,
      kind: v.kind,
      direction: v.kind === "income" ? "in" : "out",
      amount: v.amount,
      account_id: v.account_id,
      category_id: v.category_id,
      merchant_id: merchant?.id ?? null,
      merchant_raw: v.merchant_raw || null,
      occurred_at: new Date(v.occurred_at).toISOString(),
      note: v.note || null,
      is_one_off: v.is_one_off,
      status: "confirmed",
      source: "manual",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const again = await o.supabase.from("transactions").select("id").eq("client_id", v.client_id).single();
      if (again.data) return { ok: true, id: again.data.id };
    }
    return dbError(error);
  }
  if (merchant && v.remember && v.kind === "expense") {
    await o.supabase.from("merchants").update({ default_category_id: v.category_id }).eq("id", merchant.id);
  }
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}

const TransferSchema = z.object({
  client_id: z.uuid(),
  from_account_id: z.uuid({ message: "Pilih akun asal." }),
  to_account_id: z.uuid({ message: "Pilih akun tujuan." }),
  amount,
  fee: z.number().int("Biaya harus bilangan bulat.").min(0, "Biaya tidak boleh negatif."),
  occurred_at: iso.refine(notFuture, "Tanggal tidak boleh lebih dari 1 hari ke depan."),
});

/** API-08 createTransfer: two sides + link (+ fee) atomically in rpc_create_transfer. */
export async function createTransfer(input: z.input<typeof TransferSchema>): Promise<ActionResult<{ link: string; warning?: string }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const p = TransferSchema.safeParse(input);
  if (!p.success) return apiError("VALIDASI", "Periksa isian yang ditandai.", fieldErrors(p.error.issues));
  const v = p.data;
  if (v.from_account_id === v.to_account_id) return apiError("VALIDASI", "Akun asal dan tujuan harus berbeda.", { to_account_id: "Akun asal dan tujuan harus berbeda." });
  const { data, error } = await o.supabase.rpc("rpc_create_transfer", {
    p_from: v.from_account_id,
    p_to: v.to_account_id,
    p_amount: v.amount,
    p_fee: v.fee,
    p_occurred_at: new Date(v.occurred_at).toISOString(),
    p_client_id: v.client_id,
  });
  if (error) return dbError(error);
  const { data: bal } = await o.supabase.rpc("account_balance_at", { p_account: v.from_account_id, p_as_of: "9999-12-31" });
  revalidatePath("/", "layout");
  // SALDO_TIDAK_CUKUP is only a warning: balances can lag behind reality
  return { ok: true, link: data as string, ...(Number(bal) < 0 ? { warning: "Saldo akun asal jadi negatif. Periksa saldo awal." } : {}) };
}

const UpdateSchema = z.object({
  id: z.uuid(),
  expected_updated_at: z.string(),
  amount: amount.optional(),
  account_id: z.uuid().optional(),
  category_id: z.uuid().nullable().optional(),
  merchant_raw: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  occurred_at: iso.refine(notFuture, "Tanggal tidak boleh lebih dari 1 hari ke depan.").optional(),
  is_one_off: z.boolean().optional(),
  remember: z.boolean().optional(),
});

/** API-09 updateTransaction with optimistic concurrency on updated_at. Email amounts stay in the evidence row. */
export async function updateTransaction(input: z.input<typeof UpdateSchema>): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const p = UpdateSchema.safeParse(input);
  if (!p.success) return apiError("VALIDASI", "Periksa isian yang ditandai.", fieldErrors(p.error.issues));
  const { id, expected_updated_at, remember, ...patch } = p.data;
  const cur = await o.supabase.from("transactions").select("updated_at, merchant_id, kind").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!cur.data) return apiError("TIDAK_DITEMUKAN", "Transaksi tidak ditemukan.");
  if (new Date(cur.data.updated_at).getTime() !== new Date(expected_updated_at).getTime()) return apiError("SUDAH_DIUBAH", "Item ini sudah berubah. Muat ulang lalu coba lagi.");
  const row: Record<string, unknown> = { ...patch };
  if (patch.occurred_at) row.occurred_at = new Date(patch.occurred_at).toISOString();
  if (patch.merchant_raw !== undefined) {
    const m = patch.merchant_raw ? await resolveMerchant(o.supabase, patch.merchant_raw, { create: true }) : null;
    row.merchant_id = m?.id ?? null;
  }
  const { error } = await o.supabase.from("transactions").update(row).eq("id", id).eq("updated_at", cur.data.updated_at);
  if (error) return dbError(error);
  const merchantId = (row.merchant_id as string | undefined) ?? cur.data.merchant_id;
  if (remember && merchantId && patch.category_id && cur.data.kind === "expense") {
    await o.supabase.from("merchants").update({ default_category_id: patch.category_id }).eq("id", merchantId);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** API-09 deleteTransaction (soft): linked transfer sides and fee go together. */
export async function deleteTransaction(id: string): Promise<ActionResult<{ undo_until: string }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.rpc("rpc_delete_transaction", { p_id: id });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, undo_until: new Date(Date.now() + 10_000).toISOString() };
}

export async function restoreTransaction(id: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.rpc("rpc_restore_transaction", { p_id: id });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setOneOff(id: string, value: boolean): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.from("transactions").update({ is_one_off: value }).eq("id", id);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * F-03.3: turn outgoing money that went to one of the owner's own accounts (an e-wallet top-up) into a transfer.
 * Accepts a batch so the Inbox can convert all pending top-ups in one go; each item stands alone.
 */
export async function convertToTransfer(items: { transaction_id: string; to_account_id: string }[]): Promise<ActionResult<{ converted: number; failed: number }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const list = z.array(z.object({ transaction_id: z.uuid(), to_account_id: z.uuid() })).min(1).max(500).safeParse(items);
  if (!list.success) return apiError("VALIDASI", "Data transfer tidak valid.");
  let converted = 0;
  let failed = 0;
  for (const it of list.data) {
    const { error } = await o.supabase.rpc("rpc_convert_to_transfer", { p_tx: it.transaction_id, p_to: it.to_account_id });
    if (error) failed++;
    else converted++;
  }
  revalidatePath("/", "layout");
  if (!converted) return apiError("GAGAL", "Belum ada yang dijadikan transfer. Muat ulang lalu coba lagi.");
  return { ok: true, converted, failed };
}

/** Category suggestion from merchant memory (F-03.1). */
export async function suggestCategory(name: string): Promise<{ category_id: string | null; one_off: boolean }> {
  const o = await ownerOrError();
  if (!o.ok || !name.trim()) return { category_id: null, one_off: false };
  const m = await resolveMerchant(o.supabase, name, { create: false });
  return { category_id: m?.default_category_id ?? null, one_off: m?.default_one_off ?? false };
}

/** F-12.4 local parse (the LLM fallback lives in /api/quick-add/parse). */
export async function quickParse(text: string, accountNames: string[]) {
  return parseQuickAdd(text.slice(0, 200), accountNames);
}

// ---------------------------------------------------------------- API-11 categories & merchant rules
const CategorySchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Nama kategori wajib diisi.").max(30, "Maksimal 30 karakter."),
  kind: z.enum(["expense", "income"]),
  icon_key: z.string().min(1).max(40),
  tone_key: z.string().min(1).max(40),
});

export async function saveCategory(input: z.input<typeof CategorySchema>): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const p = CategorySchema.safeParse(input);
  if (!p.success) return apiError("VALIDASI", "Periksa isian.", fieldErrors(p.error.issues));
  const { id, ...v } = p.data;
  const { error } = id ? await o.supabase.from("categories").update({ name: v.name, icon_key: v.icon_key, tone_key: v.tone_key }).eq("id", id) : await o.supabase.from("categories").insert(v);
  if (error) return error.code === "23505" ? apiError("NAMA_SAMA", "Nama kategori sudah dipakai.", { name: "Nama kategori sudah dipakai." }) : dbError(error);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Categories are archived, never hard-deleted when used (F-03.5). */
export async function archiveCategory(id: string, archive = true): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.from("categories").update({ archived_at: archive ? new Date().toISOString() : null }).eq("id", id);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const cat = await o.supabase.from("categories").select("is_system").eq("id", id).maybeSingle();
  if (cat.data?.is_system) return apiError("KATEGORI_SISTEM", "Kategori awal tidak bisa dihapus. Arsipkan saja.");
  const { count } = await o.supabase.from("transactions").select("id", { count: "exact", head: true }).eq("category_id", id);
  if (count) return apiError("KATEGORI_DIPAKAI", `Kategori dipakai ${count} transaksi. Arsipkan saja.`);
  const { error } = await o.supabase.from("categories").delete().eq("id", id);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true };
}

const RuleSchema = z.object({
  merchant_id: z.uuid(),
  default_category_id: z.uuid().nullable(),
  default_one_off: z.boolean(),
  skip_review: z.boolean(),
});

export async function saveMerchantRule(input: z.input<typeof RuleSchema>): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const p = RuleSchema.safeParse(input);
  if (!p.success) return apiError("VALIDASI", "Periksa isian.", fieldErrors(p.error.issues));
  const { merchant_id, ...v } = p.data;
  const { error } = await o.supabase.from("merchants").update(v).eq("id", merchant_id);
  if (error) return dbError(error);
  revalidatePath("/pengaturan");
  return { ok: true };
}

/** Merge `fromId` into `intoId`: its name becomes an alias; the target's settings win (F-03.5, F-05.4). */
export async function mergeMerchant(fromId: string, intoId: string): Promise<ActionResult<{ moved: number }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  if (fromId === intoId) return apiError("VALIDASI", "Pilih merchant yang berbeda.");
  const from = await o.supabase.from("merchants").select("match_key").eq("id", fromId).single();
  if (from.error) return apiError("TIDAK_DITEMUKAN", "Merchant tidak ditemukan.");
  const moved = await o.supabase.from("transactions").update({ merchant_id: intoId }, { count: "exact" }).eq("merchant_id", fromId);
  await o.supabase.from("subscriptions").update({ merchant_id: intoId }).eq("merchant_id", fromId);
  await o.supabase.from("merchant_aliases").update({ merchant_id: intoId }).eq("merchant_id", fromId);
  await o.supabase.from("merchants").delete().eq("id", fromId);
  const { error } = await o.supabase.from("merchant_aliases").upsert({ merchant_id: intoId, alias_key: normalizeMerchant(from.data.match_key) }, { onConflict: "user_id,alias_key" });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, moved: moved.count ?? 0 };
}

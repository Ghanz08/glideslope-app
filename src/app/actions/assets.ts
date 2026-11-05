"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerOrError } from "@/lib/server/owner";
import { apiError, dbError, fieldErrors, type ActionResult } from "@/lib/server/errors";
import { now, todayWib } from "@/lib/core/dates";
import { addMonths } from "@/lib/core/dates";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Isi tanggal.");
const notFuture = (d: string) => d <= todayWib(now());
const done = () => revalidatePath("/", "layout");

const AssetSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, "Nama wajib diisi.").max(60, "Maksimal 60 karakter."),
    type: z.enum(["deposit", "money_market_fund", "fixed_income_fund", "equity_fund", "bond", "stock", "gold", "crypto", "other"]),
    quantity: z.number().min(0, "Jumlah tidak boleh negatif.").refine((n) => Math.round(n * 1e4) === n * 1e4, "Maksimal 4 angka desimal."),
    unit_price: z.number().positive("Harga harus lebih dari 0.").optional(),
    cost_basis: z.number().int().min(0).nullable().optional(),
    maturity_date: date.nullable().optional(),
    interest_rate_pa: z.number().min(0).max(100).nullable().optional(),
    coupon_day: z.number().int().min(1, "Tanggal 1–31.").max(31, "Tanggal 1–31.").nullable().optional(),
    destination_account_id: z.uuid().nullable().optional(),
    funded_from_account_id: z.uuid().nullable().optional(),
  })
  .refine((v) => (v.type !== "deposit" && v.type !== "bond") || !!v.maturity_date, { path: ["maturity_date"], message: "Isi tanggal jatuh tempo." });

/** API-25 saveAsset. A new asset gets its first price; buying from an account records an investment (not spending). */
export async function saveAsset(input: z.input<typeof AssetSchema>): Promise<ActionResult<{ id: string }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const p = AssetSchema.safeParse(input);
  if (!p.success) return apiError("VALIDASI", "Periksa isian yang ditandai.", fieldErrors(p.error.issues));
  const { id, unit_price, funded_from_account_id, ...v } = p.data;
  // deposits and bonds are one unit priced at the principal
  const principal = v.type === "deposit" || v.type === "bond";
  const row = { ...v, quantity: principal ? 1 : v.quantity, coupon_day: v.type === "bond" ? (v.coupon_day ?? null) : null };
  if (id) {
    const { error } = await o.supabase.from("assets").update(row).eq("id", id);
    if (error) return dbError(error);
    done();
    return { ok: true, id };
  }
  if (!unit_price) return apiError("VALIDASI", "Periksa isian.", { unit_price: principal ? "Isi nilai pokok." : "Isi harga per unit." });
  const today = todayWib(now());
  if (funded_from_account_id) {
    // created empty, then bought atomically so the account balance and the asset move together
    const { data, error } = await o.supabase.from("assets").insert({ ...row, quantity: 0 }).select("id").single();
    if (error) return dbError(error);
    await o.supabase.from("asset_prices").insert({ asset_id: data.id, as_of: today, unit_price });
    const amount = Math.round(row.quantity * unit_price);
    const r = await o.supabase.rpc("rpc_purchase_asset", { p_asset: data.id, p_amount: amount, p_quantity: row.quantity, p_account: funded_from_account_id, p_on: today });
    if (r.error) return dbError(r.error);
    done();
    return { ok: true, id: data.id };
  }
  const { data, error } = await o.supabase.from("assets").insert(row).select("id").single();
  if (error) return dbError(error);
  const pr = await o.supabase.from("asset_prices").insert({ asset_id: data.id, as_of: today, unit_price });
  if (pr.error) return dbError(pr.error);
  done();
  return { ok: true, id: data.id };
}

export async function archiveAsset(id: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.from("assets").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) return dbError(error);
  done();
  return { ok: true };
}

/** Manual price; a second price on the same date replaces the first (F-07.1). */
export async function saveAssetPrice(input: { asset_id: string; as_of: string; unit_price: number }): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  if (!(input.unit_price > 0)) return apiError("VALIDASI", "Periksa isian.", { unit_price: "Harga harus lebih dari 0." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.as_of) || !notFuture(input.as_of)) return apiError("VALIDASI", "Periksa isian.", { as_of: "Tanggal tidak boleh di masa depan." });
  const { error } = await o.supabase.from("asset_prices").upsert(input, { onConflict: "asset_id,as_of" });
  if (error) return dbError(error);
  done();
  return { ok: true };
}

/** API-27 redeemAsset: redemption transaction + ASSET_EVENT atomically; never income. */
export async function redeemAsset(input: { asset_id: string; amount: number; destination_account_id: string; fee: number; occurred_on: string }): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  if (!Number.isInteger(input.amount) || input.amount <= 0) return apiError("VALIDASI", "Periksa isian.", { amount: "Jumlah harus lebih dari 0." });
  if (!Number.isInteger(input.fee) || input.fee < 0) return apiError("VALIDASI", "Periksa isian.", { fee: "Biaya tidak boleh negatif." });
  if (!notFuture(input.occurred_on)) return apiError("VALIDASI", "Periksa isian.", { occurred_on: "Tanggal tidak boleh di masa depan." });
  const { error } = await o.supabase.rpc("rpc_redeem_asset", {
    p_asset: input.asset_id,
    p_amount: input.amount,
    p_account: input.destination_account_id,
    p_fee: input.fee,
    p_on: input.occurred_on,
  });
  if (error) {
    const e = dbError(error);
    if (e.error.code === "MELEBIHI_NILAI") e.error.fields = { amount: "Jumlah melebihi nilai aset." };
    return e;
  }
  done();
  return { ok: true };
}

/** Roll a matured deposit into a new term: same principal, new maturity date. */
export async function rolloverDeposit(input: { asset_id: string; maturity_date: string }): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.from("assets").update({ maturity_date: input.maturity_date }).eq("id", input.asset_id).eq("type", "deposit");
  if (error) return dbError(error);
  done();
  return { ok: true };
}

export async function purchaseAsset(input: { asset_id: string; amount: number; quantity: number; account_id: string; occurred_on: string }): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  if (!Number.isInteger(input.amount) || input.amount <= 0 || !(input.quantity > 0)) return apiError("VALIDASI", "Periksa isian.", { amount: "Isi jumlah dan unit." });
  const { error } = await o.supabase.rpc("rpc_purchase_asset", { p_asset: input.asset_id, p_amount: input.amount, p_quantity: input.quantity, p_account: input.account_id, p_on: input.occurred_on });
  if (error) return dbError(error);
  done();
  return { ok: true };
}

// ---------------------------------------------------------------- API-23 planned expenses
const PlannedSchema = z.object({
  id: z.uuid().optional(),
  label: z.string().trim().min(1, "Label wajib diisi.").max(40, "Maksimal 40 karakter."),
  amount: z.number().int().min(1, "Jumlah harus lebih dari 0."),
  due_on: date,
  repeat_months: z.number().int().min(1, "Ulangi 1 sampai 12 bulan.").max(12, "Ulangi 1 sampai 12 bulan.").nullable(),
  repeat_until: date.nullable(),
  category_id: z.uuid().nullable(),
});

export async function savePlannedExpense(input: z.input<typeof PlannedSchema>): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const p = PlannedSchema.safeParse(input);
  if (!p.success) return apiError("VALIDASI", "Periksa isian yang ditandai.", fieldErrors(p.error.issues));
  const { id, ...v } = p.data;
  const { error } = id ? await o.supabase.from("planned_expenses").update(v).eq("id", id) : await o.supabase.from("planned_expenses").insert(v);
  if (error) return dbError(error);
  done();
  return { ok: true };
}

/** "Hapus kemunculan ini" marks one occurrence as skipped; "Hapus semua" deletes the plan. */
export async function deletePlannedExpense(id: string, occurrence?: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  if (occurrence) {
    const cur = await o.supabase.from("planned_expenses").select("due_on, repeat_months, paid_occurrences").eq("id", id).single();
    if (cur.error) return apiError("TIDAK_DITEMUKAN", "Rencana tidak ditemukan.");
    if (cur.data.repeat_months && occurrence === cur.data.due_on) {
      // dropping the first occurrence moves the series start forward
      const { error } = await o.supabase.from("planned_expenses").update({ due_on: addMonths(cur.data.due_on, cur.data.repeat_months) }).eq("id", id);
      if (error) return dbError(error);
    } else {
      const { error } = await o.supabase.from("planned_expenses").update({ paid_occurrences: [...cur.data.paid_occurrences, occurrence] }).eq("id", id);
      if (error) return dbError(error);
    }
  } else {
    const { error } = await o.supabase.from("planned_expenses").delete().eq("id", id);
    if (error) return dbError(error);
  }
  done();
  return { ok: true };
}

export async function markPlannedPaid(id: string, occurrence: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const cur = await o.supabase.from("planned_expenses").select("paid_occurrences").eq("id", id).single();
  if (cur.error) return apiError("TIDAK_DITEMUKAN", "Rencana tidak ditemukan.");
  const { error } = await o.supabase.from("planned_expenses").update({ paid_occurrences: [...new Set([...cur.data.paid_occurrences, occurrence])] }).eq("id", id);
  if (error) return dbError(error);
  done();
  return { ok: true };
}

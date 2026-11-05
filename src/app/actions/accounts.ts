"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerOrError } from "@/lib/server/owner";
import { apiError, dbError, fieldErrors, type ActionResult } from "@/lib/server/errors";
import { now, todayWib } from "@/lib/core/dates";

const AccountSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Nama wajib diisi.").max(40, "Maksimal 40 karakter."),
  kind: z.enum(["bank", "ewallet", "cash"], { message: "Pilih jenis akun." }),
  last4: z.string().regex(/^\d{4}$/, "Isi 4 digit angka.").nullable().optional(),
  number: z.string().trim().transform((s) => s.replace(/[\s-]/g, "")).pipe(z.string().regex(/^\d{6,20}$/, "Isi 6–20 digit angka.")).nullable().optional(),
  match_hints: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  opening_balance: z
    .string()
    .trim()
    .refine((s) => /^\d[\d.]*$/.test(s) && !/\.\d{1,2}$/.test(s), "Saldo harus bilangan bulat rupiah.")
    .transform((s) => Number(s.replace(/\./g, "")))
    .refine((n) => n <= 10_000_000_000, "Saldo di luar batas (maksimal Rp 10.000.000.000)."),
  opening_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Isi tanggal saldo awal."),
});

export type AccountInput = z.input<typeof AccountSchema>;

/** API-04 saveAccount */
export async function saveAccount(input: AccountInput): Promise<ActionResult<{ id: string }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const p = AccountSchema.safeParse(input);
  if (!p.success) return apiError("VALIDASI", "Periksa isian yang ditandai.", fieldErrors(p.error.issues));
  const { id, ...rest } = p.data;
  // the full number decides the last 4 digits used for email matching
  const v = { ...rest, number: rest.number || null, last4: rest.number ? rest.number.slice(-4) : (rest.last4 ?? null) };
  if (v.opening_date > todayWib(now())) return apiError("VALIDASI", "Periksa isian.", { opening_date: "Tanggal tidak boleh di masa depan." });

  const dup = await o.supabase.from("accounts").select("id").ilike("name", v.name.replace(/[%_]/g, "\\$&")).is("archived_at", null);
  if (dup.data?.some((d) => d.id !== id)) return apiError("NAMA_SAMA", "Nama akun sudah dipakai.", { name: "Nama akun sudah dipakai." });

  if (id) {
    const cur = await o.supabase.from("accounts").select("is_system").eq("id", id).single();
    if (cur.data?.is_system) return apiError("AKUN_SISTEM", "Akun sistem tidak bisa diubah.");
    const { error } = await o.supabase.from("accounts").update(v).eq("id", id);
    if (error) return dbError(error);
    revalidatePath("/", "layout");
    return { ok: true, id };
  }
  const { count } = await o.supabase.from("accounts").select("id", { count: "exact", head: true }).eq("is_system", false);
  const { data, error } = await o.supabase.from("accounts").insert({ ...v, sort_order: count ?? 0 }).select("id").single();
  if (error) return error.code === "23505" ? apiError("NAMA_SAMA", "Nama akun sudah dipakai.", { name: "Nama akun sudah dipakai." }) : dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}

export async function archiveAccount(id: string, archive = true): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const acc = await o.supabase.from("accounts").select("is_system").eq("id", id).maybeSingle();
  if (!acc.data) return apiError("TIDAK_DITEMUKAN", "Akun tidak ditemukan.");
  if (acc.data.is_system) return apiError("AKUN_SISTEM", "Akun sistem tidak bisa diarsipkan.");
  if (archive) {
    const { count } = await o.supabase.from("accounts").select("id", { count: "exact", head: true }).eq("is_system", false).is("archived_at", null);
    if ((count ?? 0) <= 1) return apiError("AKUN_TERAKHIR", "Sisakan minimal satu akun aktif.");
  }
  const { error } = await o.supabase.from("accounts").update({ archived_at: archive ? new Date().toISOString() : null }).eq("id", id);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function reorderAccounts(ids: string[]): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  for (const [i, id] of ids.entries()) {
    const { error } = await o.supabase.from("accounts").update({ sort_order: i }).eq("id", id).eq("is_system", false);
    if (error) return dbError(error);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** API-06 saveCheckpoint (F-11.1). Returns the difference against the computed balance. */
export async function saveCheckpoint(input: { account_id: string; as_of: string; balance: number }): Promise<ActionResult<{ difference: number }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.as_of)) return apiError("VALIDASI", "Isi tanggal.", { as_of: "Isi tanggal." });
  if (input.as_of > todayWib(now())) return apiError("VALIDASI", "Periksa isian.", { as_of: "Tanggal tidak boleh di masa depan." });
  if (!Number.isInteger(input.balance)) return apiError("VALIDASI", "Periksa isian.", { balance: "Saldo harus bilangan bulat rupiah." });
  const { error } = await o.supabase.from("account_checkpoints").insert({ account_id: input.account_id, as_of: input.as_of, balance: input.balance, source: "manual" });
  if (error) return dbError(error);
  const { data } = await o.supabase.rpc("account_balance_at", { p_account: input.account_id, p_as_of: input.as_of });
  revalidatePath("/", "layout");
  return { ok: true, difference: input.balance - Number(data ?? 0) };
}

"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { ownerOrError } from "@/lib/server/owner";
import { apiError, dbError, fieldErrors, type ActionResult } from "@/lib/server/errors";
import { hashPin, makeUnlockToken, PIN_RE, UNLOCK_COOKIE } from "@/lib/server/pin";
import { addDays, now, todayWib } from "@/lib/core/dates";

const money = z.coerce.number().int("Harus bilangan bulat rupiah.").min(0, "Tidak boleh negatif.");

const SettingsSchema = z
  .object({
    graduation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Isi tanggal lulus."),
    emergency_reserve: money,
    burn_override: money.nullable(),
    large_amount_threshold: z.coerce.number().int().min(10_000, "Ambang minimal Rp 10.000.").max(50_000_000, "Ambang maksimal Rp 50.000.000."),
    idle_timeout_minutes: z.coerce.number().refine((v) => [1, 5, 15, 30].includes(v), "Pilih 1, 5, 15, atau 30 menit."),
    redaction_terms: z.array(z.string().trim().min(1).max(60)).max(50),
    payment_instructions: z.string().max(500, "Maksimal 500 karakter.").nullable(),
    llm_enabled: z.boolean(),
    auto_link_transfers: z.boolean(),
    push_prefs: z.record(z.string(), z.boolean()),
  })
  .partial();

export type SettingsInput = z.input<typeof SettingsSchema>;

/** API-03 saveSettings */
export async function saveSettings(input: SettingsInput): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) return apiError("VALIDASI", "Periksa isian yang ditandai.", fieldErrors(parsed.error.issues));
  const v = parsed.data;
  if (v.graduation_date && v.graduation_date <= todayWib(now())) {
    return apiError("VALIDASI", "Periksa isian yang ditandai.", { graduation_date: "Tanggal lulus harus setelah hari ini." });
  }
  const { error } = await o.supabase.from("app_settings").update(v).eq("user_id", o.userId);
  if (error) return apiError("GALAT", "Pengaturan belum tersimpan. Coba lagi.");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** S-03: one step at a time; progress is stored so a closed tab resumes where it was. */
export async function saveOnboardingStep(step: number, input: SettingsInput): Promise<ActionResult> {
  if (Object.keys(input).length) {
    const r = await saveSettings(input);
    if (!("ok" in r)) return r;
  }
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  if (step === 3) {
    const { count } = await o.supabase.from("accounts").select("id", { count: "exact", head: true }).eq("is_system", false).is("archived_at", null);
    if (!count) return apiError("VALIDASI", "Tambahkan minimal satu akun.", { name: "Tambahkan minimal satu akun." });
  }
  const next = Math.min(5, step + 1);
  const patch: Record<string, unknown> = { onboarding_step: Math.max(next, o.settings.onboarding_step) };
  const { error } = await o.supabase.from("app_settings").update(patch).eq("user_id", o.userId);
  if (error) return apiError("GALAT", "Pengaturan belum tersimpan. Coba lagi.");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function dismissGmailPrompt(): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  await o.supabase.from("app_settings").update({ gmail_prompt_dismissed_until: addDays(todayWib(now()), 7) }).eq("user_id", o.userId);
  revalidatePath("/");
  return { ok: true };
}

/** Banner keys: gmail, deposito, harga, ekspor, checkpoint. Hidden for 7 days. */
export async function dismissBanner(key: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const banners = { ...o.settings.dismissed_banners, [key]: new Date(now().getTime() + 7 * 86400_000).toISOString() };
  await o.supabase.from("app_settings").update({ dismissed_banners: banners }).eq("user_id", o.userId);
  revalidatePath("/");
  return { ok: true };
}

/** F-01.2: set/replace (pin) or disable (null) the app lock. Only the PBKDF2 hash and salt are stored. */
export async function setPin(pin: string | null): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  if (pin !== null && !PIN_RE.test(pin)) return apiError("VALIDASI", "PIN harus 6 angka.", { pin: "PIN harus 6 angka." });
  const patch =
    pin === null
      ? { pin_hash: null, pin_salt: null, pin_iterations: null, pin_failed_attempts: 0 }
      : (() => {
          const h = hashPin(pin);
          return { pin_hash: h.hash, pin_salt: h.salt, pin_iterations: h.iterations, pin_failed_attempts: 0 };
        })();
  const { error } = await o.supabase.from("app_settings").update(patch).eq("user_id", o.userId);
  if (error) return dbError(error);
  if (pin !== null) {
    const { value, maxAge } = makeUnlockToken(o.userId, o.settings.idle_timeout_minutes);
    (await cookies()).set(UNLOCK_COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge, path: "/" });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

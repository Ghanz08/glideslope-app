"use server";
import { revalidatePath } from "next/cache";
import { ownerOrError } from "@/lib/server/owner";
import { apiError, dbError, type ActionResult } from "@/lib/server/errors";

/** API-38 */
export async function subscribePush(sub: { endpoint: string; p256dh: string; auth: string }): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  if (!/^https:\/\//.test(sub.endpoint) || !sub.p256dh || !sub.auth) return apiError("LANGGANAN_TIDAK_VALID", "Langganan notifikasi tidak valid.");
  const { error } = await o.supabase.from("push_subscriptions").upsert(sub, { onConflict: "endpoint" });
  if (error) return dbError(error);
  revalidatePath("/pengaturan");
  return { ok: true };
}

export async function unsubscribePush(endpoint: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return dbError(error);
  revalidatePath("/pengaturan");
  return { ok: true };
}

export async function savePushPrefs(prefs: { inbox: boolean; gmail: boolean; deposito: boolean }): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.from("app_settings").update({ push_prefs: { inbox: !!prefs.inbox, gmail: !!prefs.gmail, deposito: !!prefs.deposito } }).eq("user_id", o.userId);
  if (error) return dbError(error);
  revalidatePath("/pengaturan");
  return { ok: true };
}

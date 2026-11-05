"use server";
import { revalidatePath } from "next/cache";
import { ownerOrError } from "@/lib/server/owner";
import { apiError, dbError, type ActionResult } from "@/lib/server/errors";
import { detectSubscription } from "@/lib/core/insights";
import { wibDate } from "@/lib/core/dates";

async function setStatus(id: string, from: string[], to: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { data, error } = await o.supabase.from("subscriptions").update({ status: to }).eq("id", id).in("status", from).select("id");
  if (error) return dbError(error);
  if (!data?.length) return apiError("STATUS_TIDAK_VALID", "Status langganan sudah berubah.");
  revalidatePath("/langganan");
  return { ok: true };
}

/** API-35 */
export async function approveSubscription(id: string) {
  return setStatus(id, ["suggested"], "active");
}
export async function dismissSubscription(id: string) {
  return setStatus(id, ["suggested"], "dismissed");
}
export async function stopSubscription(id: string) {
  return setStatus(id, ["active"], "stopped");
}

/** Same rule as the daily maintenance job, run on demand for the owner (F-11.2). */
export async function detectSubscriptionsNow(): Promise<ActionResult<{ found: number }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { data, error } = await o.supabase
    .from("transactions")
    .select("merchant_id, occurred_at, amount")
    .eq("kind", "expense")
    .neq("status", "ignored")
    .is("deleted_at", null)
    .not("merchant_id", "is", null)
    .order("occurred_at");
  if (error) return dbError(error);
  const by = new Map<string, { date: string; amount: number }[]>();
  for (const t of data ?? []) by.set(t.merchant_id, [...(by.get(t.merchant_id) ?? []), { date: wibDate(t.occurred_at), amount: Number(t.amount) }]);
  const { data: existing } = await o.supabase.from("subscriptions").select("id, merchant_id, status");
  let found = 0;
  for (const [merchant_id, txs] of by) {
    if (txs.length < 3) continue;
    const s = detectSubscription(txs);
    if (!s) continue;
    const ex = existing?.find((e) => e.merchant_id === merchant_id);
    if (!ex) {
      await o.supabase.from("subscriptions").insert({ merchant_id, ...s, status: "suggested" });
      found++;
    } else if (ex.status === "active" || ex.status === "suggested") {
      await o.supabase.from("subscriptions").update(s).eq("id", ex.id);
    }
  }
  revalidatePath("/langganan");
  return { ok: true, found };
}

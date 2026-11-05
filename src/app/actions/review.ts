"use server";
import { revalidatePath } from "next/cache";
import { ownerOrError } from "@/lib/server/owner";
import { apiError, dbError, type ActionResult } from "@/lib/server/errors";

const done = () => revalidatePath("/", "layout");

/** API-20 confirmReview — also bulk-confirms open merchant_baru items of the same merchant when `remember`. */
export async function confirmReview(input: {
  transaction_id: string;
  category_id?: string | null;
  account_id?: string | null;
  remember?: boolean;
  expected_updated_at?: string;
}): Promise<ActionResult<{ confirmed: number }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { data, error } = await o.supabase.rpc("rpc_confirm_review", {
    p_tx: input.transaction_id,
    p_category: input.category_id ?? null,
    p_account: input.account_id ?? null,
    p_remember: input.remember ?? true,
    p_expected_updated_at: input.expected_updated_at ?? null,
  });
  if (error) return dbError(error);
  done();
  return { ok: true, confirmed: Number(data) };
}

/** 8.3 bulk review of AI suggestions: the same confirmation per merchant, one revalidation for the whole batch. */
export async function confirmSuggestions(
  items: { transaction_id: string; category_id: string; account_id: string; expected_updated_at: string }[],
): Promise<ActionResult<{ confirmed: string[]; failed: number }>> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const confirmed: string[] = [];
  let failed = 0;
  for (const it of items.slice(0, 500)) {
    const { error } = await o.supabase.rpc("rpc_confirm_review", {
      p_tx: it.transaction_id, p_category: it.category_id, p_account: it.account_id, p_remember: true, p_expected_updated_at: it.expected_updated_at,
    });
    if (error) failed++;
    else confirmed.push(it.transaction_id);
  }
  done();
  return { ok: true, confirmed, failed };
}

async function setStatus(id: string, from: string[], to: string, reason: string | null): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { data, error } = await o.supabase
    .from("transactions")
    .update({ status: to, review_reason: reason })
    .eq("id", id)
    .in("status", from)
    .is("deleted_at", null)
    .select("id");
  if (error) return dbError(error);
  if (!data?.length) return apiError("STATUS_BERUBAH", "Item ini sudah berubah.");
  if (to === "ignored") {
    await o.supabase
      .from("match_proposals")
      .update({ status: "closed", resolved_at: new Date().toISOString() })
      .eq("status", "open")
      .or(`transaction_id.eq.${id},other_transaction_id.eq.${id}`);
  }
  done();
  return { ok: true };
}

/** Abaikan: needs_review / confirmed / auto_confirmed → ignored (5.3). */
export async function ignoreReview(id: string) {
  return setStatus(id, ["needs_review", "confirmed", "auto_confirmed"], "ignored", null);
}

/** Tandai perlu dicek: auto_confirmed → needs_review. */
export async function markNeedsReview(id: string) {
  return setStatus(id, ["auto_confirmed"], "needs_review", "kepercayaan_rendah");
}

/** Urungkan/Pulihkan: ignored → needs_review. */
export async function undoReview(id: string) {
  return setStatus(id, ["ignored"], "needs_review", "kepercayaan_rendah");
}

/** API-21 */
export async function acceptProposal(id: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.rpc("rpc_accept_proposal", { p_id: id });
  if (error) return dbError(error);
  done();
  return { ok: true };
}

export async function rejectProposal(id: string): Promise<ActionResult> {
  const o = await ownerOrError();
  if (!o.ok) return o.error;
  const { error } = await o.supabase.rpc("rpc_reject_proposal", { p_id: id });
  if (error) return dbError(error);
  done();
  return { ok: true };
}

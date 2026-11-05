import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMerchant } from "@/lib/core/domain";

export interface MerchantInfo {
  id: string;
  display_name: string;
  default_category_id: string | null;
  default_one_off: boolean;
  skip_review: boolean;
}

/** Find a merchant by its normalised key (aliases first), creating it when `create` is set. Works for user and service clients. */
export async function resolveMerchant(
  s: SupabaseClient,
  name: string,
  opts: { create: boolean; userId?: string },
): Promise<MerchantInfo | null> {
  const display = name.trim().slice(0, 80);
  if (!display) return null;
  const key = normalizeMerchant(display);
  const cols = "id, display_name, default_category_id, default_one_off, skip_review";
  // service-role callers (ingest) bypass RLS, so they must scope by user explicitly
  const uid = opts.userId ?? "";
  const aliasQ = s.from("merchant_aliases").select(`merchants(${cols})`).eq("alias_key", key);
  const alias = await (uid ? aliasQ.eq("user_id", uid) : aliasQ).maybeSingle();
  const viaAlias = (alias.data as { merchants: MerchantInfo | null } | null)?.merchants;
  if (viaAlias) return viaAlias;
  const byKey = () => {
    const q = s.from("merchants").select(cols).eq("match_key", key);
    return (uid ? q.eq("user_id", uid) : q).maybeSingle();
  };
  const direct = await byKey();
  if (direct.data) return direct.data as MerchantInfo;
  if (!opts.create) return null;
  const ins = await s
    .from("merchants")
    .insert({ display_name: display, match_key: key, ...(opts.userId ? { user_id: opts.userId } : {}) })
    .select(cols)
    .single();
  if (ins.error) {
    // lost a race with another insert of the same key
    const again = await byKey();
    return (again.data as MerchantInfo) ?? null;
  }
  return ins.data as MerchantInfo;
}

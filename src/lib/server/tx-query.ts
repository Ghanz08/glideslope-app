import "server-only";
import type { Supa } from "./supabase";
import { txSelect, type TxRow } from "@/components/tx-list";
import { addMonths, wibStart } from "@/lib/core/dates";

export interface TxFilters {
  jenis?: string; // semua | pengeluaran | pemasukan | transfer
  kategori?: string;
  akun?: string;
  dari?: string;
  sampai?: string;
  bulan?: string; // YYYY-MM
  status?: string;
  label?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const encodeCursor = (t: TxRow) => Buffer.from(`${t.occurred_at}|${t.id}`).toString("base64url");
function decodeCursor(c: string): { t: string; id: string } | null {
  const [t, id] = Buffer.from(c, "base64url").toString().split("|");
  return t && id && UUID.test(id) && !Number.isNaN(Date.parse(t)) ? { t, id } : null;
}

/** Shared by S-08 and GET /api/transactions (API-10). Returns null on invalid parameters. */
export async function queryTransactions(s: Supa, f: TxFilters): Promise<{ items: TxRow[]; next_cursor: string | null } | null> {
  const limit = Math.min(Math.max(f.limit ?? 30, 1), 100);
  if (f.label && !UUID.test(f.label)) return null;
  let q = s.from("transactions").select(f.label ? `${txSelect}, tl:transaction_labels!inner(label_id)` : txSelect).is("deleted_at", null);
  if (f.label) q = q.eq("tl.label_id", f.label);
  if (f.jenis === "pengeluaran") q = q.in("kind", ["expense", "fee"]);
  else if (f.jenis === "pemasukan") q = q.eq("kind", "income");
  else if (f.jenis === "transfer") q = q.eq("kind", "transfer");
  else if (f.jenis && f.jenis !== "semua") return null;
  if (f.kategori) {
    if (!UUID.test(f.kategori)) return null;
    q = q.eq("category_id", f.kategori);
  }
  if (f.akun) {
    if (!UUID.test(f.akun)) return null;
    q = q.eq("account_id", f.akun);
  }
  if (f.status) {
    if (!["needs_review", "confirmed", "auto_confirmed", "ignored"].includes(f.status)) return null;
    q = q.eq("status", f.status);
  }
  if (f.bulan) {
    if (!/^\d{4}-\d{2}$/.test(f.bulan)) return null;
    const start = `${f.bulan}-01`;
    q = q.gte("occurred_at", wibStart(start).toISOString()).lt("occurred_at", wibStart(addMonths(start, 1)).toISOString());
  }
  if (f.dari) {
    if (!DATE.test(f.dari)) return null;
    q = q.gte("occurred_at", wibStart(f.dari).toISOString());
  }
  if (f.sampai) {
    if (!DATE.test(f.sampai)) return null;
    q = q.lt("occurred_at", new Date(wibStart(f.sampai).getTime() + 86400_000).toISOString());
  }
  const term = (f.q ?? "").replace(/[,()*%\\:."']/g, " ").trim();
  if (term.length >= 2) q = q.or(`merchant_raw.ilike.*${term}*,note.ilike.*${term}*`);
  if (f.cursor) {
    const c = decodeCursor(f.cursor);
    if (!c) return null;
    q = q.or(`occurred_at.lt.${c.t},and(occurred_at.eq.${c.t},id.lt.${c.id})`);
  }
  const { data, error } = await q.order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown as TxRow[];
  const items = rows.slice(0, limit);
  return { items, next_cursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null };
}

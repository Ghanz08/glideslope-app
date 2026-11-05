import "server-only";
import type { Supa } from "./supabase";
import { txSelect, txTitle, txCategory, type TxRow } from "@/components/tx-list";
import { REASON_LABEL, displayName, topUpTarget, type ReviewReason } from "@/lib/core/domain";
import { formatRupiah } from "@/lib/core/money";
import { foldNewMerchants } from "@/lib/core/inbox-group";
import type { CategorySuggestion } from "@/lib/ingest/llm";

export type InboxFilter = "semua" | "cocok" | "merchant_baru" | "belum_terkait";

export interface Proposal {
  id: string;
  type: "transfer" | "repayment" | "receipt_link" | "duplicate_suspect";
  score: number;
  fee_amount: number;
  other: TxRow | null;
  receipt: { id: string; merchant_name: string | null; occurred_at: string | null; subtotal: number | null; tax_amount: number; tax_rate_pct: number | null; total: number; receipt_items: { name: string; line_total: number; position: number }[] } | null;
  receivable: { id: string; person_name: string; remaining: number } | null;
}

export interface InboxItem {
  key: string;
  tx: TxRow;
  proposals: Proposal[];
  title: string;
  subtitle: string;
  bucket: Exclude<InboxFilter, "semua">[];
  groupCount: number; // > 1 when several open items of the same new merchant are folded into one card
  groupIds: string[];
  /** 8.3 AI suggestion for an uncategorised expense of this merchant; the owner still confirms. */
  suggestion?: CategorySuggestion;
  /** F-03.3: outgoing money whose recipient names one of the owner's e-wallets (a top-up), to turn into a transfer. */
  topUpTo?: { id: string; name: string };
}

const PROPOSAL_LABEL: Record<Proposal["type"], string> = {
  transfer: "Transfer antar akun?",
  repayment: "Pelunasan piutang?",
  receipt_link: "Email + nota cocok",
  duplicate_suspect: "Diduga duplikat",
};

/** Open Inbox cards, counted the way the Inbox shows them: a new merchant's transactions fold into one card (F-04.6). */
export async function inboxCount(s: Supa): Promise<number> {
  const [tx, mp] = await Promise.all([
    s.from("transactions").select("merchant_id, review_reason").eq("status", "needs_review").is("deleted_at", null).limit(2000),
    s
      .from("match_proposals")
      .select("id, t:transactions!match_proposals_transaction_id_fkey!inner(status)", { count: "exact", head: true })
      .eq("status", "open")
      .neq("t.status", "needs_review"),
  ]);
  const rows = tx.data ?? [];
  const folded = new Set(rows.filter((r) => r.review_reason === "merchant_baru" && r.merchant_id).map((r) => r.merchant_id));
  const single = rows.filter((r) => !(r.review_reason === "merchant_baru" && r.merchant_id)).length;
  return single + folded.size + (mp.count ?? 0);
}

export async function getInboxItems(s: Supa): Promise<InboxItem[]> {
  const [txs, props, sugg, walletRes] = await Promise.all([
    s.from("transactions").select(txSelect).eq("status", "needs_review").is("deleted_at", null).order("created_at", { ascending: false }).limit(500),
    s
      .from("match_proposals")
      .select(
        `id, type, score, fee_amount, transaction_id, created_at,
         main:transactions!match_proposals_transaction_id_fkey(${txSelect}),
         other:transactions!match_proposals_other_transaction_id_fkey(${txSelect}),
         receipt:receipts(id, merchant_name, occurred_at, subtotal, tax_amount, tax_rate_pct, total, receipt_items(name, line_total, position)),
         receivable:receivables(id, person_name, remaining)`,
      )
      .eq("status", "open")
      .order("created_at", { ascending: false }),
    s.from("llm_jobs").select("ref_id, result").eq("kind", "categorize").eq("status", "done").limit(1000),
    s.from("accounts").select("id, name, match_hints, last4").eq("kind", "ewallet").is("archived_at", null),
  ]);
  const wallets = (walletRes.data ?? []) as { id: string; name: string; match_hints: string[]; last4: string | null }[];
  const suggestions = new Map((sugg.data ?? []).map((j) => [j.ref_id as string, j.result as CategorySuggestion]));
  const byTx = new Map<string, InboxItem>();
  const mk = (tx: TxRow): InboxItem => ({
    key: tx.id,
    tx,
    proposals: [],
    title: txTitle(tx),
    subtitle: tx.review_reason ? REASON_LABEL[tx.review_reason as ReviewReason] : "",
    bucket: [],
    groupCount: 1,
    groupIds: [tx.id],
  });
  for (const t of (txs.data ?? []) as unknown as TxRow[]) byTx.set(t.id, mk(t));
  for (const p of (props.data ?? []) as unknown as (Proposal & { transaction_id: string; main: TxRow | null })[]) {
    if (!p.main || p.main.deleted_at) continue;
    const item = byTx.get(p.transaction_id) ?? mk(p.main);
    item.proposals.push({ ...p, score: Number(p.score), fee_amount: Number(p.fee_amount) });
    byTx.set(p.transaction_id, item);
  }

  const items = [...byTx.values()];
  for (const it of items) {
    const p = it.proposals[0];
    const sg = it.tx.merchant_id && !it.tx.category_id && it.tx.kind === "expense" ? suggestions.get(it.tx.merchant_id) : undefined;
    if (sg && (sg.category_id || sg.is_transfer)) it.suggestion = sg;
    // Livin' top-ups carry no merchant, only the wallet name ("OVO", "GoPay Customer") as recipient
    if (it.tx.direction === "out" && it.tx.kind === "expense" && !it.tx.merchant_id && !p && it.tx.account_id && ["transfer_tidak_jelas", "nominal_besar"].includes(it.tx.review_reason ?? "")) {
      const to = topUpTarget(it.tx.merchant_raw, wallets.filter((w) => w.id !== it.tx.account_id));
      if (to) {
        it.topUpTo = to;
        it.subtitle = `Isi saldo ke ${to.name}?`;
      }
    }
    const evidence = it.tx.transaction_evidence?.length ?? 0;
    if (p?.type === "receipt_link" && p.receipt?.merchant_name) it.title = displayName(p.receipt.merchant_name);
    if (p) it.subtitle = p.type === "repayment" && p.receivable ? `Pelunasan ${p.receivable.person_name}?` : PROPOSAL_LABEL[p.type];
    else if (evidence >= 2) it.subtitle = "Email + nota cocok";
    if (it.tx.review_reason === "hanya_nota") it.subtitle = "Nota tanpa email";
    if (it.tx.review_reason === "transfer_tidak_jelas" && it.tx.direction === "in") it.subtitle = "Belum terkait piutang";
    if (evidence >= 2 || p?.type === "receipt_link") it.bucket.push("cocok");
    if (it.tx.review_reason === "merchant_baru") it.bucket.push("merchant_baru");
    if (["transfer_tidak_jelas", "hanya_nota", "akun_tidak_dikenal"].includes(it.tx.review_reason ?? "") && !p) it.bucket.push("belum_terkait");
    if (it.tx.direction === "in" && it.tx.kind !== "transfer" && it.tx.review_reason === "transfer_tidak_jelas") it.title = `Transfer masuk · ${txTitle(it.tx)}`;
  }

  // F-04.6: fold open items of the same new merchant into one card
  return foldNewMerchants(items.map((it) => ({ ...it, merchantId: it.tx.merchant_id, reason: it.tx.review_reason, hasProposal: it.proposals.length > 0 }))).map((g) => {
    const ids = g.groupIndexes.map((i) => items[i].tx.id);
    return { ...g, groupIds: ids, subtitle: g.groupCount > 1 ? `Merchant baru · ${g.groupCount} transaksi` : g.subtitle };
  });
}

export function itemAmountText(it: InboxItem) {
  return `${it.tx.direction === "in" ? "+" : "−"}${formatRupiah(Number(it.tx.amount))}`;
}

export const itemCategory = (it: InboxItem) => txCategory(it.tx);

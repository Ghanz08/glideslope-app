import type { Metadata } from "next";
import { CircleCheck, Mail, Receipt, TriangleAlert } from "lucide-react";
import { requireOwner } from "@/lib/server/owner";
import { getAccounts, getCategories, getLabels } from "@/lib/server/queries";
import { txCategory, txLabels, txSelect, txTitle, type TxRow } from "@/components/tx-list";
import { LabelPicker } from "@/components/label-picker";
import { BigAmount, ButtonLink, Card, CategoryTile, EmptyState, PageTitle } from "@/components/ui";
import { formatLongDate, formatTime } from "@/lib/core/dates";
import { formatRupiah } from "@/lib/core/money";
import { REASON_LABEL, topUpTarget, type ReviewReason } from "@/lib/core/domain";
import { convertToTransfer } from "@/app/actions/transactions";
import { ActButton } from "@/components/act-button";
import { DetailActions } from "./detail-actions";

export const metadata: Metadata = { title: "Detail transaksi" };

const SOURCE: Record<string, string> = { manual: "Dicatat manual", email: "Dari email", receipt: "Dari nota", webhook: "Dari notifikasi HP" };
const STATUS: Record<string, string> = { needs_review: "Perlu dicek", confirmed: "Dikonfirmasi", auto_confirmed: "Masuk otomatis", ignored: "Diabaikan" };

export default async function DetailPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const { id } = await params;
  const { data } = await gate.supabase.from("transactions").select(txSelect).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!data) {
    return (
      <Card><EmptyState title="Transaksi tidak ditemukan." body="Mungkin sudah dihapus." action={<ButtonLink href="/transaksi" variant="sekunder">Lihat semua transaksi</ButtonLink>} /></Card>
    );
  }
  const t = data as unknown as TxRow;
  const [{ data: ev }, link, accounts, categories, labels, walletRes] = await Promise.all([
    gate.supabase.from("transaction_evidence").select("role, parsed_amount, match_score, ingest_events(sender, subject, received_at, parsed), receipts(id, merchant_name, occurred_at, subtotal, tax_amount, tax_rate_pct, service_charge, total, receipt_items(name, line_total, position))").eq("transaction_id", id),
    gate.supabase.from("transfer_links").select("id").or(`out_transaction_id.eq.${id},in_transaction_id.eq.${id},fee_transaction_id.eq.${id}`).maybeSingle(),
    getAccounts(gate.supabase),
    getCategories(gate.supabase, t.kind === "income" ? "income" : "expense"),
    getLabels(gate.supabase),
    gate.supabase.from("accounts").select("id, name, match_hints, last4").eq("kind", "ewallet").is("archived_at", null).neq("id", t.account_id),
  ]);
  // F-03.3: a top-up to the owner's own e-wallet that was saved as spending can still become a transfer
  const topUp = t.direction === "out" && t.kind === "expense" && !link.data ? topUpTarget(t.merchant_raw, walletRes.data ?? []) : undefined;
  const evidence = (ev ?? []) as unknown as {
    role: string; parsed_amount: number | null;
    ingest_events: { sender: string; subject: string | null; received_at: string } | null;
    receipts: { id: string; merchant_name: string | null; occurred_at: string | null; subtotal: number | null; tax_amount: number; tax_rate_pct: number | null; total: number; receipt_items: { name: string; line_total: number; position: number }[] } | null;
  }[];
  const emailAmount = evidence.find((e) => e.role === "email" || e.role === "webhook")?.parsed_amount;
  const c = txCategory(t);
  const receiptName = evidence.find((e) => e.receipts?.merchant_name)?.receipts?.merchant_name;
  return (
    <>
      <PageTitle title="Detail transaksi" />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <div className="flex items-start gap-4">
            <CategoryTile icon={c.icon_key} tone={c.tone_key} size={52} name={txTitle(t)} />
            <div className="min-w-0 flex-1">
              <h2 className="text-[20px] font-bold">{txTitle(t)}</h2>
              {receiptName && receiptName !== txTitle(t) && <p className="text-[14px] text-teks-redup">Di nota: {receiptName}</p>}
              <p className="text-[14px] text-teks-redup">{formatLongDate(t.occurred_at)} · {formatTime(t.occurred_at)} · {t.accounts?.name}</p>
            </div>
          </div>
          <div className="mt-6"><BigAmount value={t.amount} sign={t.direction === "in" ? "+" : "−"} /></div>
          {emailAmount != null && Number(emailAmount) !== Number(t.amount) && (
            <p role="status" className="mt-3 flex items-center gap-2 text-[14px] text-peringatan"><TriangleAlert size={16} aria-hidden />Jumlah berbeda dari email.</p>
          )}
          <dl className="mt-6 grid grid-cols-[120px_1fr] gap-y-3 border-t border-garis pt-5 text-[14px]">
            <dt className="text-teks-redup">Kategori</dt><dd>{c.name}</dd>
            <dt className="flex h-8 items-center text-teks-redup">Label</dt><dd><LabelPicker transactionId={t.id} value={txLabels(t)} labels={labels} /></dd>
            <dt className="text-teks-redup">Akun</dt><dd>{t.accounts?.name}</dd>
            <dt className="text-teks-redup">Sumber</dt><dd>{SOURCE[t.source]}</dd>
            <dt className="text-teks-redup">Status</dt><dd>{STATUS[t.status]}{t.review_reason ? ` · ${REASON_LABEL[t.review_reason as ReviewReason]}` : ""}</dd>
            {t.is_one_off && (<><dt className="text-teks-redup">Sekali-jalan</dt><dd>Ya, tidak dihitung rata-rata rutin</dd></>)}
            {t.note && (<><dt className="text-teks-redup">Catatan</dt><dd>{t.note}</dd></>)}
          </dl>
          {topUp && (
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-strip bg-aksen-lembut p-4 text-[14px] text-aksen">
              <p className="min-w-0 flex-1">Ini isi saldo ke akun {topUp.name} milikmu. Sebagai transfer, uangnya tidak dihitung pengeluaran dan saldo {topUp.name} bertambah.</p>
              <ActButton variant="utama" action={convertToTransfer.bind(null, [{ transaction_id: t.id, to_account_id: topUp.id }])} done={`Dijadikan transfer ke ${topUp.name}.`}>
                Jadikan transfer ke {topUp.name}
              </ActButton>
            </div>
          )}
          <div className="mt-6 border-t border-garis pt-5">
            <DetailActions
              id={t.id} updatedAt={t.updated_at} amount={Number(t.amount)} merchant={t.merchant_raw ?? ""} note={t.note ?? ""}
              categoryId={t.category_id} accountId={t.account_id} isOneOff={t.is_one_off} linked={!!link.data}
              editableCategory={["expense", "income", "fee"].includes(t.kind)}
              categories={categories.map((x) => ({ id: x.id, name: x.name }))} accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
            />
          </div>
        </Card>
        <Card>
          <h2 className="mb-4 text-[16px] font-bold">Bukti</h2>
          {evidence.length === 0 && <p className="text-[14px] text-teks-redup">Belum ada bukti email atau nota.</p>}
          <div className="flex flex-col gap-5">
            {evidence.map((e, i) => (
              <section key={i} className="text-[14px]">
                <h3 className="mb-2 flex items-center gap-2 font-semibold">
                  {e.role === "receipt" ? <Receipt size={16} aria-hidden /> : <Mail size={16} aria-hidden />}
                  {e.role === "receipt" ? "Nota" : e.role === "webhook" ? "Notifikasi HP" : "Email"}
                  {evidence.length > 1 && <CircleCheck size={16} className="text-aksen" aria-label="cocok" />}
                </h3>
                {e.ingest_events && (
                  <dl className="grid grid-cols-[96px_1fr] gap-y-1.5">
                    <dt className="text-teks-redup">Pengirim</dt><dd className="truncate">{e.ingest_events.sender}</dd>
                    {e.ingest_events.subject && (<><dt className="text-teks-redup">Subjek</dt><dd>{e.ingest_events.subject}</dd></>)}
                    <dt className="text-teks-redup">Nominal</dt><dd className="tabular">{e.parsed_amount != null ? formatRupiah(Number(e.parsed_amount)) : "—"}</dd>
                    <dt className="text-teks-redup">Waktu</dt><dd className="tabular">{formatTime(e.ingest_events.received_at, true)}</dd>
                  </dl>
                )}
                {e.receipts && (
                  <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
                    {[...e.receipts.receipt_items].sort((a, b) => a.position - b.position).map((it, j) => (
                      <div key={j} className="contents"><dt>{it.name}</dt><dd className="tabular text-right">{formatRupiah(Number(it.line_total)).replace("Rp ", "")}</dd></div>
                    ))}
                    <dt className="text-teks-redup">Subtotal</dt><dd className="tabular text-right">{formatRupiah(Number(e.receipts.subtotal ?? 0)).replace("Rp ", "")}</dd>
                    {Number(e.receipts.tax_amount) > 0 && (<><dt className="text-teks-redup">Pajak{e.receipts.tax_rate_pct ? ` ${e.receipts.tax_rate_pct}%` : ""}</dt><dd className="tabular text-right">{formatRupiah(Number(e.receipts.tax_amount)).replace("Rp ", "")}</dd></>)}
                    <dt className="font-semibold">Total</dt><dd className="tabular text-right font-semibold">{formatRupiah(Number(e.receipts.total)).replace("Rp ", "")}</dd>
                  </dl>
                )}
              </section>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

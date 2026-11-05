import type { Metadata } from "next";
import { requireOwner } from "@/lib/server/owner";
import { archiveLabel } from "@/app/actions/labels";
import { ActButton } from "@/components/act-button";
import { TxList, txSelect, type TxRow } from "@/components/tx-list";
import { ButtonLink, Card, EmptyState, PageTitle } from "@/components/ui";
import { formatPct, formatRupiah } from "@/lib/core/money";
import { LabelForm } from "../label-form";
import { summarize, TargetBar, type LabelWithTx } from "../shared";

export const metadata: Metadata = { title: "Label" };

export default async function LabelDetail({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const { id } = await params;
  const [{ data: l }, { data: txs }] = await Promise.all([
    gate.supabase.from("labels").select("id, name, auto_one_off, target_amount, archived_at, transaction_labels(transactions(amount, kind, status, deleted_at))").eq("id", id).maybeSingle(),
    gate.supabase.from("transactions").select(`${txSelect}, tl:transaction_labels!inner(label_id)`).eq("tl.label_id", id).is("deleted_at", null)
      .order("occurred_at", { ascending: false }).limit(500),
  ]);
  if (!l) return <Card><EmptyState title="Label tidak ditemukan." action={<ButtonLink href="/label" variant="sekunder">Semua label</ButtonLink>} /></Card>;
  const label = l as unknown as LabelWithTx;
  const s = summarize(label);
  const target = label.target_amount == null ? null : Number(label.target_amount);
  const rows = (txs ?? []) as unknown as TxRow[];

  return (
    <>
      <PageTitle
        title={`#${label.name}`}
        subtitle={label.archived_at ? "Diarsipkan" : label.auto_one_off ? "Acara khusus: transaksinya tidak ikut rata-rata bulanan" : undefined}
        action={<ButtonLink href={`/transaksi?label=${label.id}`} variant="lembut">Lihat di Transaksi</ButtonLink>}
      />
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <p className="text-[14px] text-teks-redup">{target ? "Sudah dibayar" : "Total pengeluaran"}</p>
            <p className="tabular mt-1 text-[32px] leading-10 font-bold tracking-[-0.02em]">{formatRupiah(s.spent)}</p>
            {target != null && s.pct != null && (
              <div className="mt-4">
                <TargetBar pct={s.pct} />
                <dl className="mt-3 grid grid-cols-3 gap-4 text-[14px]">
                  <div><dt className="text-teks-redup">Target</dt><dd className="tabular font-semibold">{formatRupiah(target)}</dd></div>
                  <div><dt className="text-teks-redup">Sisa</dt><dd className="tabular font-semibold">{formatRupiah(s.remaining ?? 0)}</dd></div>
                  <div><dt className="text-teks-redup">Tercapai</dt><dd className="tabular font-semibold">{formatPct(s.pct)}</dd></div>
                </dl>
              </div>
            )}
            <p className="mt-4 text-[13px] text-teks-pelan">{s.count} pengeluaran dihitung; transaksi yang diabaikan tidak termasuk.</p>
          </Card>
          <Card className="overflow-hidden p-0">
            <h2 className="px-5 pt-5 pb-3 text-[16px] font-bold">Transaksi</h2>
            <TxList rows={rows} emptyText="Belum ada transaksi berlabel ini. Pasang label dari Inbox atau halaman detail transaksi." />
          </Card>
        </div>
        <Card>
          <h2 className="mb-4 text-[16px] font-bold">Pengaturan label</h2>
          <LabelForm label={{ id: label.id, name: label.name, auto_one_off: label.auto_one_off, target_amount: target }} onSaved="stay" />
          <div className="mt-6 border-t border-garis pt-5">
            {label.archived_at ? (
              <ActButton variant="sekunder" action={archiveLabel.bind(null, label.id, false)} done="Label dipulihkan.">Pulihkan label</ActButton>
            ) : (
              <ActButton variant="bahaya" action={archiveLabel.bind(null, label.id, true)} done="Label diarsipkan." redirectTo="/label"
                confirm={{ title: `Arsipkan #${label.name}?`, body: "Label tidak muncul lagi di pilihan. Transaksinya tetap ada dan tetap berlabel.", verb: "Arsipkan" }}>
                Arsipkan label
              </ActButton>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

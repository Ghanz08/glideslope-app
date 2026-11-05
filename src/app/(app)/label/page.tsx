import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Tag } from "lucide-react";
import { requireOwner } from "@/lib/server/owner";
import { formatRupiah } from "@/lib/core/money";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { LabelForm } from "./label-form";
import { summarize, TargetBar, type LabelWithTx } from "./shared";

export const metadata: Metadata = { title: "Label" };

export default async function LabelPage() {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const { data } = await gate.supabase
    .from("labels")
    .select("id, name, auto_one_off, target_amount, archived_at, transaction_labels(transactions(amount, kind, status, deleted_at))")
    .order("archived_at", { nullsFirst: true })
    .order("name");
  const labels = (data ?? []) as unknown as LabelWithTx[];
  const active = labels.filter((l) => !l.archived_at);
  const archived = labels.filter((l) => l.archived_at);

  return (
    <>
      <PageTitle title="Label" subtitle="Kelompokkan transaksi lintas kategori untuk satu acara atau proyek, misalnya umroh atau liburan." />
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_380px]">
        <Card className="p-0">
          {active.length === 0 ? (
            <EmptyState icon={Tag} title="Belum ada label" body="Buat label di samping, lalu pasang di transaksi dari Inbox atau halaman detail transaksi." />
          ) : (
            <ul>
              {active.map((l) => {
                const s = summarize(l);
                return (
                  <li key={l.id} className="border-b border-garis last:border-0">
                    <Link href={`/label/${l.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-latar lg:px-6">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[16px] font-bold"><span aria-hidden className="mr-0.5 text-teks-pelan">#</span>{l.name}</span>
                          {l.auto_one_off && <span className="shrink-0 rounded-full bg-isian px-2 text-[12px] leading-5 font-semibold text-teks-redup">sekali-jalan</span>}
                        </span>
                        <span className="mt-0.5 block text-[13px] text-teks-redup">
                          {s.count} transaksi · {formatRupiah(s.spent)}
                          {s.remaining != null && ` dari ${formatRupiah(Number(l.target_amount))} · sisa ${formatRupiah(s.remaining)}`}
                        </span>
                        {s.pct != null && <span className="mt-2 block max-w-md"><TargetBar pct={s.pct} /></span>}
                      </span>
                      {s.pct != null && <span className="tabular text-[15px] font-bold">{String(s.pct).replace(".", ",")}%</span>}
                      <ChevronRight size={18} className="shrink-0 text-teks-pelan" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {archived.length > 0 && (
            <details className="border-t border-garis px-5 py-3 text-[14px] lg:px-6">
              <summary className="cursor-pointer py-1 font-semibold text-teks-redup">Diarsipkan ({archived.length})</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {archived.map((l) => (
                  <li key={l.id}><Link href={`/label/${l.id}`} className="flex min-h-10 items-center text-teks-redup hover:text-teks">#{l.name}</Link></li>
                ))}
              </ul>
            </details>
          )}
        </Card>
        <Card>
          <h2 className="mb-4 text-[16px] font-bold">Label baru</h2>
          <LabelForm onSaved="reset" />
        </Card>
      </div>
    </>
  );
}

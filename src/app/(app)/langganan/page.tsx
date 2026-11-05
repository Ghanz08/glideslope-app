import type { Metadata } from "next";
import { Repeat, TriangleAlert } from "lucide-react";
import { requireOwner } from "@/lib/server/owner";
import { today } from "@/lib/server/queries";
import { approveSubscription, detectSubscriptionsNow, dismissSubscription, stopSubscription } from "@/app/actions/subscriptions";
import { ActButton } from "@/components/act-button";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { addDays, formatDate } from "@/lib/core/dates";
import { formatRupiah } from "@/lib/core/money";

export const metadata: Metadata = { title: "Langganan" };

export default async function LanggananPage() {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const t = today();
  const { data } = await gate.supabase.from("subscriptions").select("id, period, avg_amount, last_seen_on, next_expected_on, status, merchants(display_name)").order("next_expected_on");
  const subs = (data ?? []) as unknown as { id: string; period: string; avg_amount: number; last_seen_on: string; next_expected_on: string; status: string; merchants: { display_name: string } | null }[];
  const suggested = subs.filter((s) => s.status === "suggested");
  const active = subs.filter((s) => s.status === "active");
  const perMonth = active.reduce((a, s) => a + (s.period === "yearly" ? Math.round(Number(s.avg_amount) / 12) : Number(s.avg_amount)), 0);
  return (
    <>
      <PageTitle title="Langganan" subtitle={`Total per bulan: ${formatRupiah(perMonth)}`} action={<ActButton variant="lembut" action={detectSubscriptionsNow} done="Pemeriksaan selesai.">Periksa sekarang</ActButton>} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-0">
          <h2 className="px-5 pt-5 text-[16px] font-bold">Usulan</h2>
          {suggested.length === 0 ? <EmptyState icon={Repeat} title="Belum ada usulan" body="Usulan muncul bila ada 3 tagihan rutin dari merchant yang sama." /> : (
            <ul>
              {suggested.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 border-b border-garis px-5 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{s.merchants?.display_name}</p>
                    <p className="text-[13px] text-teks-redup">{s.period === "yearly" ? "Tahunan" : "Bulanan"} · sekitar {formatRupiah(Number(s.avg_amount))}</p>
                  </div>
                  <ActButton variant="lembut" action={approveSubscription.bind(null, s.id)} done="Langganan disetujui.">Setujui</ActButton>
                  <ActButton variant="teks" action={dismissSubscription.bind(null, s.id)} done="Usulan ditolak.">Tolak</ActButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-0">
          <h2 className="px-5 pt-5 text-[16px] font-bold">Aktif</h2>
          {active.length === 0 ? <EmptyState title="Belum ada langganan aktif" /> : (
            <ul>
              {active.map((s) => {
                const missing = addDays(s.next_expected_on, 7) < t;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 border-b border-garis px-5 py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{s.merchants?.display_name}</p>
                      <p className="text-[13px] text-teks-redup">Berikutnya {formatDate(s.next_expected_on)} · {formatRupiah(Number(s.avg_amount))}/{s.period === "yearly" ? "thn" : "bln"}</p>
                      {missing && <p className="flex items-center gap-1 text-[13px] font-semibold text-peringatan"><TriangleAlert size={14} aria-hidden />Tidak terdeteksi bulan ini</p>}
                    </div>
                    <ActButton variant="teks" action={stopSubscription.bind(null, s.id)} done="Langganan dihentikan.">Hentikan</ActButton>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

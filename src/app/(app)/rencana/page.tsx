import type { Metadata } from "next";
import { requireOwner } from "@/lib/server/owner";
import { getCategories, getPlanned, today } from "@/lib/server/queries";
import { expandPlanned } from "@/lib/core/runway";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { formatDate } from "@/lib/core/dates";
import { formatRupiah } from "@/lib/core/money";
import { OccurrenceActions, PlannedForm } from "./planned-form";

export const metadata: Metadata = { title: "Rencana pengeluaran" };

export default async function RencanaPage() {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const t = today();
  const g = gate.settings.graduation_date;
  const [planned, cats] = await Promise.all([getPlanned(gate.supabase), getCategories(gate.supabase, "expense")]);
  const occ = expandPlanned(planned, g).filter((o) => !o.paid);
  const untilGrad = occ.filter((o) => o.date > t && (!g || o.date <= g));
  const repeating = new Set(planned.filter((p) => p.repeat_months).map((p) => p.id));
  return (
    <>
      <PageTitle title="Rencana pengeluaran" subtitle={`Total sampai lulus: ${formatRupiah(untilGrad.reduce((a, o) => a + o.amount, 0))} · ${untilGrad.length} kemunculan`} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card className="p-0">
          {occ.length === 0 ? <EmptyState title="Belum ada pengeluaran terjadwal" body="Tambahkan biaya semester atau tagihan besar agar runway memperhitungkannya." /> : (
            <ul>
              {occ.map((o) => (
                <li key={`${o.planned_id}-${o.date}`} className="flex flex-wrap items-center gap-3 border-b border-garis px-5 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{o.label}</p>
                    <p className="text-[13px] text-teks-redup">{formatDate(o.date)}{o.date <= t ? " · lewat, tidak dihitung di proyeksi" : ""}</p>
                  </div>
                  <span className="tabular font-semibold">{formatRupiah(o.amount)}</span>
                  <OccurrenceActions id={o.planned_id!} date={o.date} past={o.date <= t} repeating={repeating.has(o.planned_id!)} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-4 text-[16px] font-bold">Tambah rencana</h2>
          <PlannedForm categories={cats.map((c) => ({ id: c.id, name: c.name }))} />
        </Card>
      </div>
    </>
  );
}

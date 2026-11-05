import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { requireOwner } from "@/lib/server/owner";
import { getAccounts, today } from "@/lib/server/queries";
import { writeOffReceivable } from "@/app/actions/split";
import { ActButton } from "@/components/act-button";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { daysBetween, wibDate } from "@/lib/core/dates";
import { formatRupiah } from "@/lib/core/money";
import { CashRepay } from "./repay";

export const metadata: Metadata = { title: "Piutang" };

export default async function PiutangPage() {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const t = today();
  const [{ data }, accounts] = await Promise.all([
    gate.supabase.from("receivables").select("id, person_name, amount, remaining, status, created_at, split_participants(split_bills(id, title))").in("status", ["open", "partially_paid"]).order("created_at"),
    getAccounts(gate.supabase),
  ]);
  const rows = (data ?? []) as unknown as { id: string; person_name: string; amount: number; remaining: number; status: string; created_at: string; split_participants: { split_bills: { id: string; title: string } } }[];
  const byPerson = new Map<string, typeof rows>();
  for (const r of rows) byPerson.set(r.person_name, [...(byPerson.get(r.person_name) ?? []), r]);
  const total = rows.reduce((a, r) => a + Number(r.remaining), 0);
  return (
    <>
      <PageTitle title="Piutang" subtitle={`Total belum dibayar ${formatRupiah(total)} · tidak dihitung di dana tersisa`} />
      {rows.length === 0 ? <Card><EmptyState icon={Users} title="Tidak ada piutang terbuka" body="Piutang muncul setelah kamu membagikan tagihan." /></Card> : (
        <div className="flex flex-col gap-4">
          {[...byPerson].map(([person, list]) => (
            <Card key={person} className="p-0">
              <h2 className="flex justify-between px-5 pt-5 text-[16px] font-bold">{person}<span className="tabular">{formatRupiah(list.reduce((a, r) => a + Number(r.remaining), 0))}</span></h2>
              <ul>
                {list.map((r) => {
                  const age = daysBetween(wibDate(r.created_at), t);
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-garis px-5 py-3 last:border-0">
                      <div className="min-w-0 flex-1">
                        <Link href={`/bagi/${r.split_participants.split_bills.id}`} className="font-semibold hover:text-aksen">{r.split_participants.split_bills.title}</Link>
                        <p className="text-[13px] text-teks-redup">Sisa {formatRupiah(Number(r.remaining))} dari {formatRupiah(Number(r.amount))} · {age} hari{age > 90 ? " · Lama" : ""}</p>
                      </div>
                      <CashRepay id={r.id} remaining={Number(r.remaining)} accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} />
                      {age > 90 && <ActButton variant="teks" action={writeOffReceivable.bind(null, r.id)} done="Piutang dihapuskan." confirm={{ title: "Hapuskan piutang?", body: "Sisa piutang tidak akan ditagih lagi.", verb: "Hapuskan piutang" }}>Hapuskan</ActButton>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

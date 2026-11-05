import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { requireOwner } from "@/lib/server/owner";
import { getAccounts, today } from "@/lib/server/queries";
import { archiveAccount, reorderAccounts } from "@/app/actions/accounts";
import { ActButton } from "@/components/act-button";
import { SourceLabel } from "@/components/account-cards";
import { Card, EmptyState, PageTitle, Secret, groupDigits, maskNumber } from "@/components/ui";
import { PrivacyToggle } from "@/components/privacy-toggle";
import { privacyOn } from "@/lib/server/privacy";
import { formatRupiah } from "@/lib/core/money";
import { NewAccount } from "./new-account";

export const metadata: Metadata = { title: "Rekening & wallet" };

export default async function AkunPage({ searchParams }: { searchParams: Promise<{ baru?: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const { baru } = await searchParams;
  const all = await getAccounts(gate.supabase, { includeArchived: true });
  const active = all.filter((a) => !a.archived);
  const archived = all.filter((a) => a.archived);
  const ids = active.map((a) => a.id);
  const move = (i: number, d: -1 | 1) => {
    const next = [...ids];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return reorderAccounts.bind(null, next);
  };
  return (
    <>
      <PageTitle title="Rekening & wallet"
        subtitle={<>{active.length} akun aktif · <Secret mask="Rp ••••••">{formatRupiah(active.reduce((a, x) => a + x.balance, 0))}</Secret></>}
        action={<PrivacyToggle initial={await privacyOn()} />} />
      <div className="mb-6"><NewAccount today={today()} open={baru === "1"} /></div>
      <Card className="p-0">
        {active.length === 0 ? (
          <EmptyState title="Belum ada akun" body="Tambah rekening, e-wallet, atau tunai untuk mulai menghitung saldo." />
        ) : (
          <ul>
            {active.map((a, i) => (
              <li key={a.id} className="flex items-center gap-3 border-b border-garis px-5 py-3 last:border-0">
                <Link href={`/akun/${a.id}`} className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {a.name}
                    {a.number ? (
                      <Secret mask={maskNumber(a.number)} className="tabular ml-2 text-[13px] font-normal text-teks-pelan">{groupDigits(a.number)}</Secret>
                    ) : a.last4 && <span className="tabular ml-2 text-[13px] text-teks-pelan">••{a.last4}</span>}
                  </p>
                  <SourceLabel label={a.label} />
                </Link>
                <Secret mask="Rp ••••••" className="tabular font-semibold">{formatRupiah(a.balance)}</Secret>
                <div className="flex">
                  {i > 0 && <ActButton variant="teks" action={move(i, -1)}><ArrowUp size={16} aria-label={`Naikkan ${a.name}`} /></ActButton>}
                  {i < active.length - 1 && <ActButton variant="teks" action={move(i, 1)}><ArrowDown size={16} aria-label={`Turunkan ${a.name}`} /></ActButton>}
                </div>
                <ActButton variant="teks" action={archiveAccount.bind(null, a.id, true)} done="Akun diarsipkan.">Arsipkan</ActButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {archived.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-[16px] font-bold">Diarsipkan</h2>
          <Card className="p-0">
            <ul>
              {archived.map((a) => (
                <li key={a.id} className="flex items-center gap-3 border-b border-garis px-5 py-3 last:border-0">
                  <span className="flex-1 text-teks-redup">{a.name}</span>
                  <Secret mask="Rp ••••••" className="tabular text-teks-redup">{formatRupiah(a.balance)}</Secret>
                  <ActButton variant="teks" action={archiveAccount.bind(null, a.id, false)} done="Akun dipulihkan.">Pulihkan</ActButton>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

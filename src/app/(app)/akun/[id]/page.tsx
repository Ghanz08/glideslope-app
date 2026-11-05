import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/server/owner";
import { getAccounts, today } from "@/lib/server/queries";
import { AccountForm } from "@/components/account-form";
import { SourceLabel } from "@/components/account-cards";
import { TxList, txSelect, type TxRow } from "@/components/tx-list";
import { ButtonLink, Card, PageTitle, Secret, groupDigits, maskNumber } from "@/components/ui";
import { PrivacyToggle } from "@/components/privacy-toggle";
import { privacyOn } from "@/lib/server/privacy";
import { formatRupiah } from "@/lib/core/money";
import { formatDate, wibStart } from "@/lib/core/dates";
import { CheckpointForm } from "./checkpoint-form";

export const metadata: Metadata = { title: "Akun" };

export default async function AkunDetail({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const { id } = await params;
  const accounts = await getAccounts(gate.supabase, { includeArchived: true });
  const a = accounts.find((x) => x.id === id);
  if (!a) notFound();
  const { data: acc } = await gate.supabase.from("accounts").select("name, kind, last4, number, match_hints, opening_balance, opening_date").eq("id", id).single();
  const hidden = await privacyOn();
  const { data: cps } = await gate.supabase.from("account_checkpoints").select("as_of, balance, created_at").eq("account_id", id).order("as_of", { ascending: false }).order("created_at", { ascending: false }).limit(2);
  const since = cps?.[1]?.as_of ?? acc!.opening_date;
  const { data: txs } = await gate.supabase.from("transactions").select(txSelect).eq("account_id", id).is("deleted_at", null)
    .gte("occurred_at", wibStart(since).toISOString()).order("occurred_at", { ascending: false }).limit(50);
  return (
    <>
      <PageTitle title={a.name} subtitle={<SourceLabel label={a.label} />} action={<ButtonLink href={`/tambah/pengeluaran?akun=${id}`} variant="lembut">Catat transaksi</ButtonLink>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[14px] text-teks-redup">Saldo terhitung</p>
              <PrivacyToggle initial={hidden} />
            </div>
            <p className="tabular text-[32px] font-bold"><Secret mask="Rp ••••••">{formatRupiah(a.balance)}</Secret></p>
            {a.number && (
              <p className="mt-1 text-[15px] text-teks-redup">
                {a.kind === "ewallet" ? "Nomor HP" : "Nomor rekening"}{" "}
                <Secret mask={maskNumber(a.number)} className="tabular font-semibold text-teks">{groupDigits(a.number)}</Secret>
              </p>
            )}
            {a.balance < 0 && <p className="text-[14px] text-teks-redup">Periksa saldo awal atau transaksi yang terlewat.</p>}
            {a.checkpoint && (
              <p className="mt-2 text-[14px] text-teks-redup">
                Titik cek {formatDate(a.checkpoint.as_of)}: <Secret mask="Rp ••••">{formatRupiah(a.checkpoint.balance)}</Secret> · terhitung <Secret mask="Rp ••••">{formatRupiah(a.checkpoint.computed)}</Secret>
              </p>
            )}
          </Card>
          <Card className="p-0">
            <h2 className="px-5 pt-5 text-[16px] font-bold">Transaksi sejak {formatDate(since)}</h2>
            <TxList rows={(txs ?? []) as unknown as TxRow[]} emptyText="Belum ada transaksi di akun ini." />
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <h2 className="mb-4 text-[16px] font-bold">Titik cek saldo</h2>
            <CheckpointForm accountId={id} today={today()} />
          </Card>
          {!a.is_system && (
            <Card>
              <h2 className="mb-4 text-[16px] font-bold">Ubah akun</h2>
              <AccountForm today={today()} initial={{ id, ...acc!, number: acc!.number ?? undefined, opening_balance: String(acc!.opening_balance) }} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

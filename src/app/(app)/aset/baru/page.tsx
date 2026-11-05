import type { Metadata } from "next";
import { requireOwner } from "@/lib/server/owner";
import { getAccounts, today } from "@/lib/server/queries";
import { Card, PageTitle } from "@/components/ui";
import { NewAssetForm } from "../asset-forms";

export const metadata: Metadata = { title: "Tambah aset" };

export default async function AsetBaru() {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const accounts = await getAccounts(gate.supabase);
  return (
    <>
      <PageTitle title="Tambah aset" subtitle="Harga diisi manual; aplikasi tidak mengambil harga pasar." />
      <Card className="max-w-[640px]"><NewAssetForm accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} today={today()} /></Card>
    </>
  );
}

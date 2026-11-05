import type { Metadata } from "next";
import { requireOwner } from "@/lib/server/owner";
import { ButtonLink, Card, PageTitle } from "@/components/ui";
import { Starter } from "./starter";

export const metadata: Metadata = { title: "Bagi tagihan" };

export default async function BagiBaru({ searchParams }: { searchParams: Promise<{ nota?: string; transaksi?: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const sp = await searchParams;
  return (
    <>
      <PageTitle title="Bagi tagihan" />
      <Card className="max-w-[560px]">
        {sp.nota || sp.transaksi ? <Starter nota={sp.nota} transaksi={sp.transaksi} /> : (
          <div className="flex flex-col gap-3">
            <p className="text-[14px] text-teks-redup">Bagi tagihan dimulai dari nota atau transaksi. Foto notanya, atau buka transaksi lalu pilih Bagi tagihan.</p>
            <ButtonLink href="/nota/baru">Scan nota</ButtonLink>
            <ButtonLink href="/transaksi?jenis=pengeluaran" variant="sekunder">Pilih dari transaksi</ButtonLink>
          </div>
        )}
      </Card>
    </>
  );
}

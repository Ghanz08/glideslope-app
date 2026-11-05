import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/server/owner";
import { getAccounts, getCategories } from "@/lib/server/queries";
import { Card, PageTitle } from "@/components/ui";
import { ReceiptEditor } from "./editor";

export const metadata: Metadata = { title: "Nota" };

const local = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 16) : "");

export default async function NotaPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const { id } = await params;
  const { data: r } = await gate.supabase.from("receipts").select("*, receipt_items(name, quantity, unit_price, line_total, position)").eq("id", id).maybeSingle();
  if (!r) notFound();
  const [accounts, cats] = await Promise.all([getAccounts(gate.supabase), getCategories(gate.supabase, "expense")]);
  const items = [...(r.receipt_items as { name: string; quantity: number; unit_price: number; line_total: number; position: number }[])]
    .sort((a, b) => a.position - b.position)
    .map((i) => ({ name: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price), line_total: Number(i.line_total) }));
  return (
    <>
      <PageTitle title={r.merchant_name ?? "Nota"} subtitle={r.status === "confirmed" ? "Dikonfirmasi" : "Tinjau hasil sebelum konfirmasi"} />
      <div className="grid gap-6 lg:grid-cols-[minmax(280px,420px)_1fr]">
        {r.image_path ? (
          <Card className="p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/receipts/${id}/image`} alt="Foto nota" className="w-full rounded-strip" />
          </Card>
        ) : <Card><p className="text-[14px] text-teks-redup">Nota manual tanpa foto.</p></Card>}
        <Card>
          <ReceiptEditor
            initial={{
              id, status: r.status, hasImage: !!r.image_path, merchant_name: r.merchant_name ?? "", occurred_at: local(r.occurred_at), items,
              subtotal: Number(r.subtotal ?? 0), service_charge: Number(r.service_charge), tax_amount: Number(r.tax_amount),
              tax_rate_pct: r.tax_rate_pct != null ? String(r.tax_rate_pct).replace(".", ",") : "", discount: Number(r.discount), rounding: Number(r.rounding),
              total: Number(r.total ?? 0), payment_method: r.payment_method ?? "",
            }}
            accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
            categories={cats.map((c) => ({ id: c.id, name: c.name }))}
            defaultTax={10}
          />
        </Card>
      </div>
    </>
  );
}

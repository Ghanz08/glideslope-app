import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/server/owner";
import { Card, PageTitle } from "@/components/ui";
import { formatDate } from "@/lib/core/dates";
import { formatRupiah } from "@/lib/core/money";
import { SplitEditor } from "./split-editor";

export const metadata: Metadata = { title: "Bagi tagihan" };
const STATUS: Record<string, string> = { draft: "Draf", shared: "Dibagikan", settled: "Lunas", cancelled: "Dibatalkan" };

export default async function BagiPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const { id } = await params;
  const { data: sb } = await gate.supabase
    .from("split_bills")
    .select("id, status, title, occurred_on, total, tax_base, receipts(merchant_name, subtotal, service_charge, tax_amount, tax_rate_pct, discount, rounding, receipt_items(id, name, line_total, position)), split_participants(id, name, phone_digits, is_owner, share_amount, position), split_assignments(receipt_item_id, participant_id, weight)")
    .eq("id", id)
    .maybeSingle();
  if (!sb) notFound();
  const r = sb.receipts as unknown as { subtotal: number; service_charge: number; tax_amount: number; tax_rate_pct: number | null; discount: number; rounding: number; receipt_items: { id: string; name: string; line_total: number; position: number }[] };
  const parts = [...(sb.split_participants as { id: string; name: string; phone_digits: string | null; is_owner: boolean; share_amount: number; position: number }[])].sort((a, b) => a.position - b.position);
  const index = new Map(parts.map((p, i) => [p.id, i]));
  return (
    <>
      <PageTitle title={sb.title} subtitle={`${formatDate(sb.occurred_on)} · total ${formatRupiah(Number(sb.total))} · ${STATUS[sb.status]}`} />
      <Card>
        <p className="mb-5 text-[14px] text-teks-redup">
          Subtotal {formatRupiah(Number(r.subtotal ?? 0))}{Number(r.service_charge) ? ` · layanan ${formatRupiah(Number(r.service_charge))}` : ""}{Number(r.tax_amount) ? ` · pajak ${r.tax_rate_pct ?? ""}${r.tax_rate_pct ? "% " : ""}${formatRupiah(Number(r.tax_amount))}` : ""}{Number(r.discount) ? ` · diskon ${formatRupiah(Number(r.discount))}` : ""}
        </p>
        <SplitEditor
          id={sb.id} status={sb.status} title={sb.title} date={formatDate(sb.occurred_on)} total={Number(sb.total)} taxBase={sb.tax_base as "items"}
          numbers={{ service_charge: Number(r.service_charge), tax_amount: Number(r.tax_amount), discount: Number(r.discount), rounding: Number(r.rounding) }}
          items={[...r.receipt_items].sort((a, b) => a.position - b.position).map((i) => ({ id: i.id, name: i.name, line_total: Number(i.line_total) }))}
          participants={parts.map((p) => ({ name: p.name, phone_digits: p.phone_digits, is_owner: p.is_owner, share_amount: Number(p.share_amount) }))}
          assignments={(sb.split_assignments as { receipt_item_id: string; participant_id: string; weight: number }[]).map((a) => ({ item_id: a.receipt_item_id, participant: index.get(a.participant_id) ?? 0, weight: Number(a.weight) }))}
          paymentInstructions={gate.settings.payment_instructions}
        />
      </Card>
    </>
  );
}

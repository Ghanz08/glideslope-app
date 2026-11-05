import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { requireOwner } from "@/lib/server/owner";
import { getAccounts, getAssets, today } from "@/lib/server/queries";
import { archiveAsset } from "@/app/actions/assets";
import { ActButton } from "@/components/act-button";
import { BigAmount, Card, PageTitle } from "@/components/ui";
import { formatDate } from "@/lib/core/dates";
import { formatRupiah } from "@/lib/core/money";
import { monthlyCoupon } from "@/lib/core/insights";
import { PriceForm, RedeemForm } from "../asset-forms";

export const metadata: Metadata = { title: "Detail aset" };
const TYPE: Record<string, string> = {
  deposit: "Deposito", bond: "Obligasi & SBN", money_market_fund: "Reksa dana pasar uang", fixed_income_fund: "Reksa dana pendapatan tetap",
  equity_fund: "Reksa dana saham & campuran", stock: "Saham", gold: "Emas", crypto: "Kripto", other: "Lainnya",
};
const UNIT: Record<string, string> = { gold: "gram", stock: "lembar", crypto: "koin" };
const PRICE_LABEL: Record<string, string> = { gold: "Harga per gram (Rp)", stock: "Harga per lembar (Rp)", crypto: "Harga per koin (Rp)" };

export default async function AsetDetail({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const { id } = await params;
  const t = today();
  const [assets, accounts, prices, events] = await Promise.all([
    getAssets(gate.supabase, t, true),
    getAccounts(gate.supabase),
    gate.supabase.from("asset_prices").select("as_of, unit_price").eq("asset_id", id).order("as_of", { ascending: false }).limit(24),
    gate.supabase.from("asset_events").select("kind, occurred_on, amount, quantity_delta").eq("asset_id", id).order("occurred_on", { ascending: false }),
  ]);
  const a = assets.find((x) => x.id === id);
  if (!a) notFound();
  const accs = accounts.map((x) => ({ id: x.id, name: x.name }));
  return (
    <>
      <PageTitle title={a.name} subtitle={`${TYPE[a.type]}${a.maturity_date ? ` · jatuh tempo ${formatDate(a.maturity_date)}` : ""}`} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <p className="text-[14px] text-teks-redup">Nilai sekarang</p>
            <BigAmount value={a.value} secret />
            {a.type !== "deposit" && a.type !== "bond" && <p className="mt-2 text-[14px] text-teks-redup">{a.quantity.toString().replace(".", ",")} {UNIT[a.type] ?? "unit"} × {a.price != null ? formatRupiah(Math.round(a.price)) : "—"}</p>}
            {a.type === "bond" && a.interest_rate_pa != null && (
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-garis pt-4 text-[14px] sm:grid-cols-3">
                <div><dt className="text-teks-redup">Kupon per tahun</dt><dd className="tabular font-semibold">{String(a.interest_rate_pa).replace(".", ",")}%</dd></div>
                <div><dt className="text-teks-redup">Dibayar</dt><dd className="font-semibold">{a.coupon_day ? `Tiap tanggal ${a.coupon_day}` : "Tiap bulan"}</dd></div>
                <div><dt className="text-teks-redup">Perkiraan bersih</dt><dd className="tabular font-semibold">{formatRupiah(monthlyCoupon(a.value, a.interest_rate_pa))}/bulan</dd></div>
              </dl>
            )}
            {a.type === "bond" && <p className="mt-3 text-[13px] text-teks-pelan">Setelah pajak final 10%. Kupon yang masuk ke rekening tercatat sebagai pemasukan.</p>}
            {a.stale && <p className="mt-2 flex items-center gap-2 text-[14px] font-semibold text-peringatan"><TriangleAlert size={16} aria-hidden />Harga lama · terakhir {a.price_as_of ? formatDate(a.price_as_of) : "belum ada"}</p>}
            {a.maturity_date && a.maturity_date < t && a.value > 0 && <p className="mt-2 text-[14px] font-semibold text-peringatan">Lewat jatuh tempo</p>}
          </Card>
          <Card>
            <h2 className="mb-3 text-[16px] font-bold">Riwayat harga</h2>
            <table className="w-full text-[14px]">
              <thead><tr className="text-teks-pelan"><th scope="col" className="py-2 text-left font-medium">Tanggal</th><th scope="col" className="py-2 text-right font-medium">{a.type === "deposit" || a.type === "bond" ? "Pokok" : "Harga per unit"}</th></tr></thead>
              <tbody>{(prices.data ?? []).map((p) => <tr key={p.as_of} className="border-t border-garis"><td className="py-2">{formatDate(p.as_of)}</td><td className="tabular py-2 text-right">{formatRupiah(Math.round(Number(p.unit_price)))}</td></tr>)}</tbody>
            </table>
            {(events.data ?? []).length > 0 && (
              <>
                <h3 className="mt-5 mb-2 text-[15px] font-bold">Pembelian dan pencairan</h3>
                <ul className="text-[14px]">{(events.data ?? []).map((e, i) => <li key={i} className="flex justify-between border-t border-garis py-2"><span>{e.kind === "purchase" ? "Beli" : e.kind === "redemption" ? "Cairkan" : "Penyesuaian"} · {formatDate(e.occurred_on)}</span><span className="tabular">{formatRupiah(Number(e.amount))}</span></li>)}</ul>
              </>
            )}
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {!a.value ? null : (
            <Card>
              <h2 className="mb-3 text-[16px] font-bold">Cairkan</h2>
              <RedeemForm assetId={a.id} value={a.value} accounts={accs} defaultAccount={a.destination_account_id} today={t} />
            </Card>
          )}
          <Card>
            <h2 className="mb-3 text-[16px] font-bold">{a.type === "deposit" || a.type === "bond" ? "Ubah pokok" : "Perbarui harga"}</h2>
            <PriceForm assetId={a.id} today={t} label={a.type === "deposit" || a.type === "bond" ? "Pokok (Rp)" : PRICE_LABEL[a.type] ?? "Harga per unit (Rp)"} />
          </Card>
          <ActButton variant="bahaya" action={archiveAsset.bind(null, a.id)} redirectTo="/aset" done="Aset diarsipkan." confirm={{ title: "Arsipkan aset?", body: "Aset tidak lagi dihitung di dana tersisa. Riwayatnya tetap tersimpan.", verb: "Arsipkan aset" }}>Arsipkan aset</ActButton>
        </div>
      </div>
    </>
  );
}

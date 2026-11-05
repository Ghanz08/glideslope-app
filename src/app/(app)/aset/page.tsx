import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChartNoAxesColumn, Clock, Coins, Gem, Info, Landmark, Plus, ScrollText, TrendingUp, Wallet } from "lucide-react";
import { requireOwner } from "@/lib/server/owner";
import { getRunway, type AssetRow } from "@/lib/server/queries";
import { ladderRows, monthlyCoupon } from "@/lib/core/insights";
import { formatDate, formatDayMonth, monthStart, wibStart } from "@/lib/core/dates";
import { formatPct, formatRupiah, formatSigned } from "@/lib/core/money";
import { BigAmount, ButtonLink, Card, EmptyState, Secret, cx } from "@/components/ui";
import { PrivacyToggle } from "@/components/privacy-toggle";
import { privacyOn } from "@/lib/server/privacy";

export const metadata: Metadata = { title: "Aset" };

// one shade per ladder position (up to 10 asset kinds); order and the labelled list carry the meaning, not colour alone
const SEGMENT = ["bg-aksen", "bg-aksen-tinggi", "bg-aksen-sedang", "bg-teks", "bg-teks-redup", "bg-teks-pelan", "bg-garis-kontrol", "bg-netral", "bg-aksen-lembut", "bg-garis"];
const ICON = {
  cash: Wallet, money_market_fund: ChartNoAxesColumn, fixed_income_fund: ChartNoAxesColumn, deposit: Landmark, bond: ScrollText,
  gold: Gem, equity_fund: ChartNoAxesColumn, stock: TrendingUp, crypto: Coins, other: Info,
};
const TYPE_NOTE: Record<string, string> = {
  gold: "harga diisi manual", money_market_fund: "NAV diisi manual", fixed_income_fund: "NAV diisi manual", equity_fund: "NAV diisi manual",
  stock: "harga diisi manual", crypto: "harga diisi manual",
};

/** "Kupon tiap tanggal 15 · ±Rp 258.750/bulan bersih" for a bond; the 10% final tax is already taken off. */
const couponText = (a: AssetRow) =>
  a.interest_rate_pa ? `Kupon${a.coupon_day ? ` tiap tanggal ${a.coupon_day}` : " bulanan"} · ±${formatRupiah(monthlyCoupon(a.value, a.interest_rate_pa))}/bulan bersih` : "Kupon tiap bulan";

export default async function AsetPage() {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const r = await getRunway(gate.supabase, gate.settings);
  const t = r.today;
  const income = await gate.supabase.from("transactions").select("amount").eq("kind", "income").neq("status", "ignored").is("deleted_at", null).gte("occurred_at", wibStart(monthStart(t)).toISOString());
  const incomeTotal = (income.data ?? []).reduce((a, x) => a + Number(x.amount), 0);

  const byType: Record<string, number> = { cash: r.cash };
  for (const a of r.assets) byType[a.type] = (byType[a.type] ?? 0) + a.value;
  const ladder = ladderRows(byType);
  const market = r.assets.reduce((a, x) => a + x.market, 0);
  const total = -r.monthSpend + incomeTotal + market;
  const maturities = r.assets.filter((a) => (a.type === "deposit" || a.type === "bond") && a.maturity_date).sort((a, b) => a.maturity_date!.localeCompare(b.maturity_date!)).slice(0, 3);
  const accountName = new Map(r.accounts.map((a) => [a.id, a.name]));
  const priceDate = r.assets.map((a) => a.price_as_of).filter(Boolean).sort().at(-1);

  const barAlt = `Komposisi dana: ${ladder.rows.map((x) => `${x.label} ${x.pct != null ? formatPct(x.pct) : "—"}`).join(", ")}.`;
  const bar = ladder.total > 0 && (
    <div role="img" aria-label={barAlt} className="mt-5 flex h-3.5 gap-[2px] overflow-hidden rounded-full">
      {ladder.rows.map((x, i) => x.value > 0 && <span key={x.key} className={SEGMENT[i]} style={{ width: `${(x.value / ladder.total) * 100}%` }} />)}
    </div>
  );

  const change = (
    <Card>
      <h2 className="mb-3 text-[16px] font-bold"><span className="lg:hidden">Perubahan bulan ini</span><span className="hidden lg:inline">Perubahan dana bulan ini</span></h2>
      <dl className="flex flex-col gap-3 text-[15px]">
        <div className="flex items-center gap-3"><ArrowDown size={18} aria-hidden className="text-teks-redup" /><dt className="flex-1 text-teks-redup">Dipakai</dt><dd className="tabular font-semibold">{formatSigned(-r.monthSpend)}</dd></div>
        {incomeTotal > 0 && <div className="flex items-center gap-3"><ArrowUp size={18} aria-hidden className="text-teks-redup" /><dt className="flex-1 text-teks-redup">Pemasukan</dt><dd className="tabular font-semibold">{formatSigned(incomeTotal)}</dd></div>}
        <div className="flex items-center gap-3"><TrendingUp size={18} aria-hidden className="text-teks-redup" /><dt className="flex-1 text-teks-redup">Perubahan pasar</dt><dd className="tabular font-semibold">{formatSigned(market)}</dd></div>
        <div className="flex items-center gap-3 border-t border-garis pt-3"><dt className="flex-1 font-bold">Total berubah</dt><dd className="tabular font-bold">{formatSigned(total)}</dd></div>
      </dl>
      {r.assets.some((a) => a.valueMonthStart == null && a.type !== "deposit") && <p className="mt-3 text-[12px] text-teks-pelan">Aset tanpa harga awal bulan dihitung tanpa perubahan pasar.</p>}
    </Card>
  );

  const maturityCard = (
    <Card>
      <h2 className="mb-3 text-[16px] font-bold">Jatuh tempo berikutnya</h2>
      {maturities.length === 0 ? <p className="text-[14px] text-teks-redup">Belum ada deposito atau obligasi.</p> : (
        <ul>
          {maturities.map((d) => (
            <li key={d.id} className="border-b border-garis last:border-0">
              <Link href={`/aset/${d.id}`} className="flex min-h-[64px] items-center gap-3 py-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-petak bg-isian">{d.type === "bond" ? <ScrollText size={18} aria-hidden /> : <Landmark size={18} aria-hidden />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{d.name}</span>
                  <span className="text-[13px] text-teks-redup">{d.maturity_date! < t ? "Lewat jatuh tempo · " : ""}{formatDate(d.maturity_date!)}{d.destination_account_id ? ` · ke ${accountName.get(d.destination_account_id) ?? "akun"}` : ""}</span>
                </span>
                <Secret mask="Rp ••••••" className="tabular font-semibold">{formatRupiah(d.value)}</Secret>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 flex gap-2 rounded-strip bg-isian p-3 text-[13px] text-teks-redup"><Info size={16} aria-hidden className="mt-0.5 shrink-0" />Pencairan tercatat sebagai transfer ke rekening, bukan pemasukan, dan nilai asetnya ikut berkurang.</p>
    </Card>
  );

  return (
    <>
      <header className="mb-4 flex items-start justify-between lg:mb-7">
        <div>
          <h1 className="text-[24px] font-bold lg:text-[28px]">Aset</h1>
          {priceDate && <p className="hidden text-[15px] text-teks-redup lg:block">Harga per {formatDate(priceDate)} · harga reksa dana, saham, dan emas diisi manual</p>}
        </div>
        <Link href="/aset/baru" aria-label="Tambah aset" className="flex h-12 w-12 items-center justify-center rounded-full bg-permukaan shadow-e1 lg:hidden"><Plus size={22} aria-hidden /></Link>
      </header>
      <div className="grid gap-6 xl:grid-cols-[1fr_minmax(340px,400px)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="lg:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-1 text-[15px] text-teks-redup">Total dana<PrivacyToggle initial={await privacyOn()} className="-my-2 h-9 w-9" /></p>
                <BigAmount value={ladder.total} secret />
              </div>
              <div className="hidden lg:block"><ButtonLink href="/aset/baru" variant="lembut"><Plus size={18} aria-hidden />Tambah aset</ButtonLink></div>
            </div>
            <div className="hidden lg:block">{bar}</div>
            <div className="mt-5 border-t border-garis pt-4 lg:hidden">{/* mobile: change summary inside the total card */}
              <dl className="flex flex-col gap-2 text-[15px]">
                <div className="flex justify-between"><dt className="text-teks-redup">Dipakai</dt><dd className="tabular font-semibold">{formatSigned(-r.monthSpend)}</dd></div>
                {incomeTotal > 0 && <div className="flex justify-between"><dt className="text-teks-redup">Pemasukan</dt><dd className="tabular font-semibold">{formatSigned(incomeTotal)}</dd></div>}
                <div className="flex justify-between"><dt className="text-teks-redup">Perubahan pasar</dt><dd className="tabular font-semibold">{formatSigned(market)}</dd></div>
              </dl>
            </div>
          </Card>

          <Card className="p-0 lg:p-0">
            <div className="px-5 pt-5 lg:hidden">
              <h2 className="text-[16px] font-bold">Tangga likuiditas</h2>
              <p className="text-[14px] text-teks-redup">Dari yang paling cepat cair</p>
              {bar}
            </div>
            {r.assets.length === 0 && <EmptyState title="Belum ada aset" body="Tambahkan deposito, obligasi, reksa dana, saham, atau emas untuk melihat tangga likuiditas." action={<ButtonLink href="/aset/baru">Tambah aset pertama</ButtonLink>} />}
            <table className="w-full text-left">
              <thead className="hidden lg:table-header-group">
                <tr className="border-b border-garis text-[13px] text-teks-pelan">
                  <th scope="col" className="px-5 py-3 font-medium">Aset</th>
                  <th scope="col" className="py-3 font-medium">Cair dalam</th>
                  <th scope="col" className="py-3 text-right font-medium">Nilai</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Pasar bulan ini</th>
                </tr>
              </thead>
              <tbody>
                {ladder.rows.map((row, i) => {
                  const items = row.key === "cash" ? [] : r.assets.filter((a) => a.type === row.key);
                  const Icon = ICON[row.key];
                  const rowMarket = items.reduce((a, x) => a + x.market, 0);
                  const single = items.length === 1 ? items[0] : null;
                  const href = row.key === "cash" ? "/akun" : single ? `/aset/${single.id}` : undefined;
                  const sub = single
                    ? single.type === "bond"
                      ? `${single.name} · ${couponText(single)}`
                      : `${single.type === "gold" ? `${single.quantity.toString().replace(".", ",")} g · ` : ""}${TYPE_NOTE[single.type] ?? (single.type === "deposit" ? "Bunga masuk saat jatuh tempo" : "")}${single.price_as_of && TYPE_NOTE[single.type] ? ` · ${formatDayMonth(single.price_as_of)}` : ""}`
                    : items.length ? `${items.length} aset` : "";
                  return (
                    <tr key={row.key} className="border-b border-garis align-top last:border-0">
                      <th scope="row" className="px-5 py-3 font-normal">
                        <div className="flex items-start gap-3">
                          <span aria-hidden className={cx("mt-1.5 h-3 w-3 shrink-0 rounded-[3px]", SEGMENT[i])} />
                          <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-petak bg-isian lg:flex"><Icon size={18} aria-hidden /></span>
                          <div className="min-w-0">
                            {href ? <Link href={href} className="text-[15px] font-semibold hover:text-aksen">{row.label}</Link> : <span className="text-[15px] font-semibold">{row.label}</span>}
                            {sub && <p className="hidden text-[13px] text-teks-redup lg:block">{sub}</p>}
                            <p className="flex items-center gap-1 text-[13px] text-teks-redup lg:hidden">{row.volatile ? <TrendingUp size={14} aria-hidden /> : <Clock size={14} aria-hidden />}{row.speed}</p>
                            {items.some((x) => x.stale) && <p className="text-[13px] font-semibold text-peringatan">Harga lama</p>}
                            {items.length > 1 && (
                              <ul className="mt-1 flex flex-col gap-0.5">
                                {items.map((x) => <li key={x.id}><Link href={`/aset/${x.id}`} className="inline-flex min-h-8 items-center gap-1 text-[13px] text-aksen">{x.name} · <Secret mask="Rp ••••">{formatRupiah(x.value)}</Secret>{x.stale ? " · Harga lama" : ""}</Link></li>)}
                              </ul>
                            )}
                          </div>
                        </div>
                      </th>
                      <td className="hidden py-3 text-[14px] text-teks-redup lg:table-cell"><span className="inline-flex items-center gap-1.5">{row.volatile ? <TrendingUp size={16} aria-hidden /> : <Clock size={16} aria-hidden />}{row.speed}</span></td>
                      <td className="py-3 pr-5 text-right lg:pr-0">
                        <Secret mask="Rp ••••••" className="tabular block font-semibold whitespace-nowrap">{formatRupiah(row.value)}</Secret>
                        <span className="tabular text-[13px] text-teks-redup">{row.pct != null ? formatPct(row.pct) : ""}</span>
                      </td>
                      <td className="tabular hidden px-5 py-3 text-right whitespace-nowrap lg:table-cell">{row.volatile || row.key === "money_market_fund" ? formatSigned(rowMarket) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <div className="hidden lg:block xl:hidden">{change}</div>
          <div className="xl:hidden">{maturityCard}</div>
        </div>
        <aside className="hidden flex-col gap-6 xl:flex" aria-label="Ringkasan aset">
          {change}
          {maturityCard}
        </aside>
      </div>
    </>
  );
}

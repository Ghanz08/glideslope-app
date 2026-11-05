import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireOwner } from "@/lib/server/owner";
import { getCategories, getSpend, monthlyTotals, today } from "@/lib/server/queries";
import { computeBurn } from "@/lib/core/runway";
import { categoryBreakdown, monthDelta } from "@/lib/core/insights";
import { addMonths, formatDayMonth, formatMonthLong, monthStart, wibDate, wibStart } from "@/lib/core/dates";
import { formatPct, formatRupiah, formatSigned } from "@/lib/core/money";
import { MonthlyBars } from "@/components/charts";
import { Card, CategoryTile, EmptyState, PageTitle, Segmented, cx } from "@/components/ui";
import { txCategory, txSelect, txTitle, type TxRow } from "@/components/tx-list";
import { OneOffSwitch } from "./one-off-switch";
import { summarize, TargetBar, type LabelWithTx } from "../label/shared";

export const metadata: Metadata = { title: "Analitik" };

const BAR: Record<string, string> = {
  makan: "bg-makan", rumah: "bg-rumah", hiburan: "bg-hiburan", belanja: "bg-belanja", pendidikan: "bg-pendidikan",
  kesehatan: "bg-kesehatan", transportasi: "bg-transportasi", tagihan: "bg-tagihan",
};
const barClass = (tone?: string | null) => BAR[tone ?? ""] ?? "bg-netral";

export default async function AnalitikPage({ searchParams }: { searchParams: Promise<{ rentang?: string; bulan?: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const sp = await searchParams;
  const t = today();
  const current = monthStart(t);
  const range = [3, 6, 12].includes(Number(sp.rentang)) ? Number(sp.rentang) : 6;
  const month = sp.bulan && /^\d{4}-\d{2}$/.test(sp.bulan) && `${sp.bulan}-01` <= current ? `${sp.bulan}-01` : current;
  const from = [addMonths(current, -(range - 1)), addMonths(month, -1), addMonths(current, -3)].sort()[0];
  const threshold = gate.settings.large_amount_threshold;
  const [spend, cats, first, large, labelRes] = await Promise.all([
    getSpend(gate.supabase, from),
    getCategories(gate.supabase, "expense", true),
    gate.supabase.from("transactions").select("occurred_at").in("kind", ["expense", "fee"]).is("deleted_at", null).order("occurred_at").limit(1).maybeSingle(),
    // F-08.3: large expenses in the chosen range
    gate.supabase.from("transactions").select(txSelect).in("kind", ["expense", "fee"]).neq("status", "ignored").is("deleted_at", null)
      .gte("amount", threshold).gte("occurred_at", wibStart(addMonths(current, -(range - 1))).toISOString()).order("occurred_at", { ascending: false }).limit(100),
    gate.supabase.from("labels").select("id, name, auto_one_off, target_amount, archived_at, transaction_labels(transactions(amount, kind, status, deleted_at))").is("archived_at", null).order("name"),
  ]);
  const labelRows = ((labelRes.data ?? []) as unknown as LabelWithTx[]).map((l) => ({ l, s: summarize(l) })).sort((a, b) => b.s.spent - a.s.spent);
  const largeRows = (large.data ?? []) as unknown as TxRow[];
  const largeTotal = largeRows.reduce((a, t) => a + Number(t.amount), 0);
  const largeRoutine = largeRows.filter((t) => !t.is_one_off).reduce((a, t) => a + Number(t.amount), 0);
  const largeMax = Math.max(1, ...largeRows.map((t) => Number(t.amount)));
  const largeByMonth = new Map<string, TxRow[]>();
  for (const r of largeRows) largeByMonth.set(monthStart(wibDate(r.occurred_at)), [...(largeByMonth.get(monthStart(wibDate(r.occurred_at))) ?? []), r]);
  const dataStart = first.data ? wibDate(first.data.occurred_at) : null;
  const bars = monthlyTotals(spend, t, range);
  const burn = computeBurn(spend.filter((x) => !x.is_one_off).map((x) => ({ date: wibDate(x.occurred_at), amount: x.effective })), dataStart, t, gate.settings.burn_override);
  const inMonth = (m: string) => spend.filter((x) => monthStart(wibDate(x.occurred_at)) === m);
  const rows = categoryBreakdown(inMonth(month));
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const prevTotal = inMonth(addMonths(month, -1)).reduce((a, r) => a + r.effective, 0);
  const delta = monthDelta(total, prevTotal);
  const catBy = new Map(cats.map((c) => [c.id, c]));
  const max = rows[0]?.amount ?? 1;
  const ym = (d: string) => d.slice(0, 7);
  const href = (patch: { rentang?: number; bulan?: string }) => `/analitik?rentang=${patch.rentang ?? range}&bulan=${patch.bulan ?? ym(month)}`;

  return (
    <>
      <PageTitle title="Analitik" subtitle="Pengeluaran efektif: bagian teman di bagi tagihan tidak dihitung." />
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[16px] font-bold">Pengeluaran per bulan</h2>
            <Segmented label="Rentang" value={String(range)} hrefFor={(v) => href({ rentang: Number(v) })}
              options={[{ value: "3", label: "3 bulan" }, { value: "6", label: "6 bulan" }, { value: "12", label: "12 bulan" }]} />
          </div>
          <MonthlyBars bars={bars} average={burn.burn} />
        </Card>
        <Card className="p-0">
          <div className="px-5 pt-5 pb-4 lg:px-6 lg:pt-6">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div>
                <h2 className="text-[16px] font-bold">Pengeluaran besar</h2>
                <p className="mt-0.5 text-[14px] text-teks-redup">Mulai {formatRupiah(threshold)} · {range} bulan terakhir · {largeRows.length} transaksi</p>
              </div>
              <p className="tabular text-[26px] leading-8 font-bold tracking-[-0.02em]">{formatRupiah(largeTotal)}</p>
            </div>
            {largeRows.length > 0 && (
              <>
                <div className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full bg-isian" role="img"
                  aria-label={`${formatRupiah(largeRoutine)} ikut rata-rata, ${formatRupiah(largeTotal - largeRoutine)} sekali-jalan`}>
                  {largeRoutine > 0 && <span className="h-full bg-aksen" style={{ width: `${(largeRoutine / largeTotal) * 100}%` }} />}
                  {largeTotal > largeRoutine && <span className="pola-diagonal h-full flex-1" />}
                </div>
                <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-aksen" />
                    <dt className="text-teks-redup">Ikut rata-rata bulanan</dt>
                    <dd className="tabular font-semibold">{formatRupiah(largeRoutine)}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="pola-diagonal h-2.5 w-2.5 rounded-full" />
                    <dt className="text-teks-redup">Sekali-jalan</dt>
                    <dd className="tabular font-semibold">{formatRupiah(largeTotal - largeRoutine)}</dd>
                  </div>
                </dl>
                <p className="mt-3 max-w-[64ch] text-[13px] text-teks-pelan">
                  Nyalakan sekali-jalan untuk yang tidak berulang, seperti biaya semester atau beli barang besar, agar rata-rata bulanan tidak melonjak.
                  Untuk acara dengan beberapa pembayaran, seperti umroh, pakai <Link href="/label" className="font-semibold text-aksen hover:underline">Label</Link>.
                </p>
              </>
            )}
          </div>
          {largeRows.length === 0 ? <EmptyState title="Tidak ada pengeluaran besar di rentang ini." /> : (
            <div>
              {[...largeByMonth].map(([m, list]) => (
                <section key={m} aria-label={formatMonthLong(m)}>
                  <h3 className="flex justify-between border-t border-garis bg-latar px-5 py-2 text-[13px] font-semibold text-teks-redup lg:px-6">
                    <span>{formatMonthLong(m)}</span>
                    <span className="tabular">{formatRupiah(list.reduce((a, t) => a + Number(t.amount), 0))}</span>
                  </h3>
                  <ul>
                    {list.map((t) => {
                      const c = txCategory(t);
                      const title = txTitle(t);
                      return (
                        <li key={t.id} className="flex items-center gap-3 border-t border-garis px-5 py-3 first:border-t-0 lg:gap-4 lg:px-6">
                          <CategoryTile icon={c.icon_key} tone={c.tone_key} size={40} name={title} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <Link href={`/transaksi/${t.id}`} className="truncate font-semibold hover:text-aksen">{title}</Link>
                              <span className={cx("tabular hidden sm:inline font-semibold whitespace-nowrap", t.is_one_off && "text-teks-pelan")}>{formatRupiah(Number(t.amount))}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-3">
                              <p className="min-w-0 flex-1 truncate text-[13px] text-teks-redup sm:w-44 sm:flex-none">
                                {formatDayMonth(t.occurred_at)} · {t.accounts?.name}
                                {t.status === "needs_review" && <span className="font-semibold text-peringatan"> · perlu dicek</span>}
                              </p>
                              <span className={cx("tabular text-[14px] font-semibold whitespace-nowrap sm:hidden", t.is_one_off && "text-teks-pelan")}>{formatRupiah(Number(t.amount))}</span>
                              <span aria-hidden className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-isian sm:block">
                                <span className={cx("block h-full rounded-full", t.is_one_off ? "pola-diagonal" : "bg-aksen")} style={{ width: `max(6px, ${(Number(t.amount) / largeMax) * 100}%)` }} />
                              </span>
                            </div>
                          </div>
                          <OneOffSwitch id={t.id} value={t.is_one_off} title={title} />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Card>
        {labelRows.length > 0 && (
          <Card>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-[16px] font-bold">Per label</h2>
              <Link href="/label" className="text-[14px] font-semibold text-aksen hover:underline">Kelola label</Link>
            </div>
            <ul className="flex flex-col gap-4">
              {labelRows.map(({ l, s }) => (
                <li key={l.id}>
                  <Link href={`/label/${l.id}`} className="group block">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-semibold group-hover:text-aksen"><span aria-hidden className="text-teks-pelan">#</span>{l.name}</span>
                      <span className="tabular font-semibold whitespace-nowrap">{formatRupiah(s.spent)}</span>
                    </span>
                    <span className="mt-0.5 block text-[13px] text-teks-redup">
                      {s.count} transaksi{l.auto_one_off ? " · sekali-jalan" : ""}
                      {s.remaining != null && ` · sisa ${formatRupiah(s.remaining)} dari ${formatRupiah(Number(l.target_amount))}`}
                    </span>
                    {s.pct != null && <span className="mt-2 block"><TargetBar pct={s.pct} /></span>}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card>
          <div className="mb-4 flex items-center justify-between gap-2">
            <Link href={href({ bulan: ym(addMonths(month, -1)) })} aria-label="Bulan sebelumnya" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-isian"><ChevronLeft size={20} aria-hidden /></Link>
            <h2 className="text-[16px] font-bold">{formatMonthLong(month)}{month === current ? " (belum selesai)" : ""}</h2>
            {month < current ? (
              <Link href={href({ bulan: ym(addMonths(month, 1)) })} aria-label="Bulan berikutnya" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-isian"><ChevronRight size={20} aria-hidden /></Link>
            ) : <span className="h-11 w-11" />}
          </div>
          {rows.length === 0 ? <EmptyState title="Belum ada data bulan ini." /> : (
            <>
              <p className="tabular text-[28px] font-bold">{formatRupiah(total)}</p>
              <p className="tabular mb-5 text-[14px] text-teks-redup">
                {formatSigned(delta.diff)} ({delta.pct == null ? "—" : `${delta.pct < 0 ? "−" : "+"}${formatPct(Math.abs(delta.pct))}`}) dibanding bulan lalu
              </p>
              <ul className="flex flex-col gap-4">
                {rows.map((r) => {
                  const c = catBy.get(r.category_id);
                  return (
                    <li key={r.category_id} className="flex items-center gap-3">
                      <CategoryTile icon={c?.icon_key} tone={c?.tone_key} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-2 text-[15px]">
                          <span className={cx("truncate font-semibold", c?.archived_at && "text-teks-redup")}>{c?.name ?? "Tanpa kategori"}</span>
                          <span className="tabular font-semibold">{formatRupiah(r.amount)}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-3">
                          <div className="h-2 flex-1 rounded-full bg-isian"><div className={cx("h-2 rounded-full", barClass(c?.tone_key))} style={{ width: `max(4px, ${(r.amount / max) * 100}%)` }} /></div>
                          <span className="tabular w-14 text-right text-[13px] text-teks-redup">{formatPct(r.share_pct)}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

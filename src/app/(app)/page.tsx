import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, CircleAlert, CircleCheck, Info, TriangleAlert, User } from "lucide-react";
import { requireOwner } from "@/lib/server/owner";
import { getRunway, inboxCount, monthlyTotals } from "@/lib/server/queries";
import { getBanners } from "@/lib/server/home";
import { dismissGmailPrompt } from "@/app/actions/settings";
import { AccountCardRow, AccountStack } from "@/components/account-cards";
import { ActButton } from "@/components/act-button";
import { Banners } from "@/components/banners";
import { MonthlyBars, RunwayChart } from "@/components/charts";
import { ReviewCard } from "@/components/review-card";
import { TxList, txSelect, type TxRow } from "@/components/tx-list";
import { Banner, BigAmount, ButtonLink, Card, Secret, Segmented, cx } from "@/components/ui";
import { PrivacyToggle } from "@/components/privacy-toggle";
import { privacyOn } from "@/lib/server/privacy";
import { addDays, addMonths, formatDate, formatLongDate, formatMonthYear, monthStart, wibStart } from "@/lib/core/dates";
import { formatJt, formatRupiah } from "@/lib/core/money";
import type { RunwayStatus } from "@/lib/core/runway";

export const metadata: Metadata = { title: "Beranda" };

const STATUS_STYLE: Record<RunwayStatus, { icon: typeof Info; cls: string }> = {
  sesuai: { icon: CircleCheck, cls: "bg-aksen-lembut text-aksen" },
  perlu_perhatian: { icon: TriangleAlert, cls: "bg-peringatan-latar text-peringatan" },
  belum_cukup: { icon: CircleAlert, cls: "bg-galat-latar text-galat" },
  data_belum_cukup: { icon: Info, cls: "bg-isian text-teks-redup" },
  tanggal_lulus_kosong: { icon: Info, cls: "bg-isian text-teks-redup" },
  tanggal_lulus_lewat: { icon: Info, cls: "bg-isian text-teks-redup" },
};

export default async function Beranda({ searchParams }: { searchParams: Promise<{ tampil?: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const { tampil } = await searchParams;
  const s = gate.supabase;
  const r = await getRunway(s, gate.settings);
  const { runway, today } = r;
  const hidden = await privacyOn();
  const [count, recent, banners, integ, autoCount] = await Promise.all([
    inboxCount(s),
    s.from("transactions").select(txSelect).is("deleted_at", null).in("status", ["confirmed", "auto_confirmed"]).order("occurred_at", { ascending: false }).limit(5),
    getBanners(s, gate.settings, r.assets, today),
    s.from("integrations").select("status").eq("provider", "gmail").maybeSingle(),
    s.from("transactions").select("id", { count: "exact", head: true }).eq("status", "auto_confirmed").gte("created_at", wibStart(addDays(today, -1)).toISOString()),
  ]);
  const rows = (recent.data ?? []) as unknown as TxRow[];
  const showGmailPrompt =
    integ.data?.status !== "terhubung" && integ.data?.status !== "perlu_hubungkan_ulang" &&
    (!gate.settings.gmail_prompt_dismissed_until || gate.settings.gmail_prompt_dismissed_until <= today);
  const st = STATUS_STYLE[runway.status];
  const bars = monthlyTotals(r.spend, today, 6).filter((b, i, all) => b.total > 0 || all.slice(0, i).some((x) => x.total > 0) || b.current);
  const plannedNext = r.occurrences.find((o) => !o.paid && o.date > today);
  const graduation = gate.settings.graduation_date;
  const projection = runway.status === "sesuai" || runway.status === "perlu_perhatian" || runway.status === "belum_cukup";

  const sentence = !projection
    ? null
    : runway.monthsBeyondGraduation != null
      ? `Cukup lebih dari ${runway.monthsBeyondGraduation} bulan setelah lulus`
      : runway.depletionDate
        ? `Cukup sampai ±${formatMonthYear(runway.depletionDate)}`
        : "Tidak habis dalam proyeksi";
  const alt = projection && graduation
    ? `Grafik runway. Dana sekarang ${formatRupiah(runway.funds)}. Sisa saat lulus ${formatMonthYear(graduation)} ${formatRupiah(runway.leftoverAtGraduation ?? 0)}. ${runway.depletionDate ? `Dana habis sekitar ${formatMonthYear(runway.depletionDate)}.` : "Dana tidak habis dalam proyeksi."}`
    : "";

  const hero = (
    <Card className="lg:p-7">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="flex items-center gap-1 text-[15px] text-teks-redup">Dana tersisa<PrivacyToggle initial={hidden} className="-my-2 h-9 w-9" /></p>
          <h2 className="mt-1"><BigAmount value={runway.funds} secret /></h2>
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <span className={cx("inline-flex w-fit items-center gap-2 rounded-full px-4 py-1.5 text-[15px] font-semibold", st.cls)}>
            <st.icon size={18} strokeWidth={1.75} aria-hidden />
            {runway.label}
          </span>
          {sentence && (
            <p className="text-[15px] text-teks-redup">
              {sentence}
              {runway.plannedCountUntilGraduation > 0 && <span className="lg:hidden"> · termasuk {runway.plannedCountUntilGraduation} {plannedNext?.label.toLowerCase() ?? "pengeluaran terjadwal"}</span>}
              <span className="hidden lg:inline"> · sisa <Secret mask="±Rp ••">±Rp {formatJt(runway.leftoverAtGraduation ?? 0)}</Secret> saat lulus</span>
            </p>
          )}
        </div>
      </div>

      {runway.status === "data_belum_cukup" && (
        <div className="mt-5"><Banner action={<ButtonLink href="/pengaturan" variant="lembut">Isi estimasi</ButtonLink>}>Isi estimasi pengeluaran bulanan agar proyeksi bisa dihitung.</Banner></div>
      )}
      {(runway.status === "tanggal_lulus_lewat" || runway.status === "tanggal_lulus_kosong") && (
        <div className="mt-5"><Banner action={<ButtonLink href="/pengaturan" variant="lembut">Perbarui</ButtonLink>}>Tanggal lulus {runway.status === "tanggal_lulus_lewat" ? "sudah lewat" : "belum diisi"}. Perbarui di Pengaturan.</Banner></div>
      )}

      {projection && graduation && (
        <>
          <div className="mt-5">
            <Segmented label="Tampilan grafik" value={tampil === "bulan" ? "bulan" : "dana"} hrefFor={(v) => (v === "bulan" ? "/?tampil=bulan" : "/")}
              options={[{ value: "dana", label: "Dana" }, { value: "bulan", label: "Per bulan" }]} />
          </div>
          <div className="mt-4">
            {tampil === "bulan" ? (
              <MonthlyBars bars={bars} average={r.burn.burn} />
            ) : (
              <>
                <div className="lg:hidden"><RunwayChart series={runway.series} today={today} graduation={graduation} end={runway.chartEnd!} leftover={runway.leftoverAtGraduation ?? 0} depletion={runway.depletionDate} alt={alt} /></div>
                <div className="hidden lg:block"><RunwayChart gridlines series={runway.series} today={today} graduation={graduation} end={runway.chartEnd!} leftover={runway.leftoverAtGraduation ?? 0} depletion={runway.depletionDate} alt={alt} /></div>
                <p className="mt-3 hidden text-[13px] text-teks-redup lg:block">Garis putus-putus: proyeksi setelah lulus. Langkah turun di grafik adalah pengeluaran terjadwal.</p>
              </>
            )}
          </div>
        </>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-garis pt-5 lg:grid-cols-3">
        <div>
          <dt className="text-[13px] text-teks-redup">Rata-rata 3 bulan</dt>
          <dd className="tabular text-[17px] font-bold">{r.burn.burn != null ? <><span className="lg:hidden">Rp {formatJt(r.burn.burn)}/bln</span><span className="hidden lg:inline">{formatRupiah(r.burn.burn)}/bln</span></> : "—"}</dd>
          <dd className="hidden text-[13px] text-teks-redup lg:block">Bulan ini Rp {formatJt(r.monthSpend)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-teks-redup">Aman dipakai per hari</dt>
          <dd className="tabular text-[17px] font-bold">{runway.safePerDay != null ? formatRupiah(runway.safePerDay) : "—"}</dd>
          <dd className="hidden text-[13px] text-teks-redup lg:block">Sampai lulus · cadangan Rp {formatJt(gate.settings.emergency_reserve)}</dd>
        </div>
        <div className="hidden lg:block">
          <dt className="text-[13px] text-teks-redup">{plannedNext ? `${plannedNext.label} terjadwal` : "Pengeluaran terjadwal"}</dt>
          <dd className="tabular text-[17px] font-bold">
            {runway.plannedCountUntilGraduation ? `${runway.plannedCountUntilGraduation} × ${formatRupiah(plannedNext?.amount ?? 0)}` : "—"}
          </dd>
          {plannedNext && <dd className="text-[13px] text-teks-redup">Berikutnya {formatDate(plannedNext.date)}</dd>}
        </div>
      </dl>
    </Card>
  );

  const reviewCard = count > 0 ? <ReviewCard count={count} autoCount={autoCount.count ?? 0} /> : null;
  const accounts = r.accounts;

  return (
    <>
      <header className="mb-4 flex items-start justify-between gap-3 lg:mb-7">
        <div>
          <h1 className="text-[24px] leading-[30px] font-bold lg:text-[28px] lg:leading-9">Beranda</h1>
          <p className="hidden text-[15px] text-teks-redup lg:block">{formatLongDate(today)}</p>
        </div>
        <Link href="/pengaturan" aria-label="Profil dan pengaturan" className="flex h-12 w-12 items-center justify-center rounded-full bg-permukaan shadow-e1">
          <User size={22} strokeWidth={1.75} aria-hidden />
        </Link>
      </header>
      <Banners items={banners} />
      {showGmailPrompt && (
        <div className="mb-4">
          <Banner action={<ActButton variant="teks" action={dismissGmailPrompt}>Tutup</ActButton>}>
            Transaksi dari email bisa masuk sendiri. <Link href="/api/gmail/connect" prefetch={false} className="font-semibold underline">Hubungkan Gmail</Link>
          </Banner>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_minmax(340px,400px)] xl:gap-7">
        <div className="flex min-w-0 flex-col gap-6">
          {hero}
          <section className="xl:hidden">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[18px] font-bold">Akun</h2>
              <Link href="/aset" className="inline-flex min-h-11 items-center gap-1 text-[15px] font-semibold text-aksen">Lihat aset <ChevronRight size={18} aria-hidden /></Link>
            </div>
            <AccountCardRow accounts={accounts} monthSpend={r.monthSpend} />
          </section>
          <div className="xl:hidden">{reviewCard}</div>
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <h2 className="text-[16px] font-bold"><span className="lg:hidden">Terbaru</span><span className="hidden lg:inline">Transaksi terbaru</span></h2>
              <Link href="/transaksi" className="inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-aksen">Lihat semua <ChevronRight size={16} aria-hidden /></Link>
            </div>
            <div className="lg:hidden"><TxList rows={rows.slice(0, 4)} emptyText="Belum ada transaksi. Catat yang pertama atau hubungkan Gmail." /></div>
            <div className="hidden lg:block"><TxList rows={rows} emptyText="Belum ada transaksi. Catat yang pertama atau hubungkan Gmail." /></div>
          </Card>
        </div>
        <aside className="hidden flex-col gap-6 xl:flex" aria-label="Ringkasan akun">
          {accounts.length ? <AccountStack accounts={accounts} monthSpend={r.monthSpend} otherAssets={r.assetTotal} /> : <AccountCardRow accounts={[]} monthSpend={0} />}
          {reviewCard}
        </aside>
      </div>
      <p className="sr-only">Bulan berjalan sejak {formatDate(monthStart(today))}; data 6 bulan sejak {formatDate(addMonths(monthStart(today), -5))}.</p>
    </>
  );
}

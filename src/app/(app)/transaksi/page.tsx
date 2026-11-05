import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarRange, X } from "lucide-react";
import { requireOwner } from "@/lib/server/owner";
import { getAccounts, getCategories, getLabels } from "@/lib/server/queries";
import { queryTransactions, type TxFilters } from "@/lib/server/tx-query";
import { TxList } from "@/components/tx-list";
import { ButtonLink, Card, EmptyState, ErrorState, PageTitle, Segmented, buttonClass } from "@/components/ui";
import { formatMonthLong } from "@/lib/core/dates";
import { LoadMore } from "./more";
import { SearchBox } from "./search";

export const metadata: Metadata = { title: "Transaksi" };

export default async function TransaksiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const sp = await searchParams;
  const f: TxFilters = { jenis: sp.jenis, kategori: sp.kategori, akun: sp.akun, dari: sp.dari, sampai: sp.sampai, bulan: sp.bulan, status: sp.status, label: sp.label, q: sp.q, limit: 50 };
  const [accounts, categories, labels] = await Promise.all([
    getAccounts(gate.supabase, { includeArchived: true, includeSystem: true }), getCategories(gate.supabase, undefined, true), getLabels(gate.supabase, true),
  ]);
  let result: Awaited<ReturnType<typeof queryTransactions>> = null;
  let failed = false;
  try {
    result = await queryTransactions(gate.supabase, f);
  } catch {
    failed = true;
  }
  const filtered = Object.entries(sp).some(([k, v]) => v && k !== "jenis") || (sp.jenis && sp.jenis !== "semua");
  const keep = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/transaksi${p.size ? `?${p}` : ""}`;
  };
  const apiQuery = new URLSearchParams(Object.entries({ kind: sp.jenis, category: sp.kategori, account: sp.akun, from: sp.dari, to: sp.sampai, bulan: sp.bulan, status: sp.status, label: sp.label, q: sp.q }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageTitle title="Transaksi" subtitle={sp.bulan ? formatMonthLong(`${sp.bulan}-01`) : undefined} action={<ButtonLink href="/analitik" variant="lembut">Analitik</ButtonLink>} />
      <div className="mb-4 flex flex-col gap-3">
        <Segmented label="Jenis" value={sp.jenis ?? "semua"} hrefFor={(v) => keep({ jenis: v === "semua" ? undefined : v })}
          options={[{ value: "semua", label: "Semua" }, { value: "pengeluaran", label: "Pengeluaran" }, { value: "pemasukan", label: "Pemasukan" }, { value: "transfer", label: "Transfer" }]} />
        <Suspense><SearchBox /></Suspense>
        <form className={`grid grid-cols-2 gap-2 ${labels.length ? "lg:grid-cols-4" : "lg:grid-cols-[repeat(3,minmax(0,1fr))_auto_auto]"}`} action="/transaksi">
          {sp.jenis && <input type="hidden" name="jenis" value={sp.jenis} />}
          {sp.q && <input type="hidden" name="q" value={sp.q} />}
          <label className="sr-only" htmlFor="f-kategori">Kategori</label>
          <select id="f-kategori" name="kategori" defaultValue={sp.kategori ?? ""} className="min-h-11 w-full min-w-0 rounded-petak border border-garis-kontrol bg-permukaan pl-3.5 text-[14px] font-medium">
            <option value="">Semua kategori</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.kind === "income" ? " (masuk)" : ""}</option>)}
          </select>
          <label className="sr-only" htmlFor="f-akun">Akun</label>
          <select id="f-akun" name="akun" defaultValue={sp.akun ?? ""} className="min-h-11 w-full min-w-0 rounded-petak border border-garis-kontrol bg-permukaan pl-3.5 text-[14px] font-medium">
            <option value="">Semua akun</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="f-status">Status</label>
          <select id="f-status" name="status" defaultValue={sp.status ?? ""} className={`${labels.length ? "" : "col-span-2 lg:col-span-1"} min-h-11 w-full min-w-0 rounded-petak border border-garis-kontrol bg-permukaan pl-3.5 text-[14px] font-medium`}>
            <option value="">Semua status</option>
            <option value="needs_review">Perlu dicek</option>
            <option value="confirmed">Dikonfirmasi</option>
            <option value="auto_confirmed">Otomatis</option>
            <option value="ignored">Diabaikan</option>
          </select>
          {labels.length > 0 && (
            <>
              <label className="sr-only" htmlFor="f-label">Label</label>
              <select id="f-label" name="label" defaultValue={sp.label ?? ""} className="min-h-11 w-full min-w-0 rounded-petak border border-garis-kontrol bg-permukaan pl-3.5 text-[14px] font-medium">
                <option value="">Semua label</option>
                {labels.map((l) => <option key={l.id} value={l.id}>#{l.name}{l.archived_at ? " (arsip)" : ""}</option>)}
              </select>
            </>
          )}
          <fieldset className={`col-span-2 flex min-h-11 min-w-0 items-center gap-1 rounded-petak border border-garis-kontrol bg-permukaan pr-1 pl-3.5 text-[14px] font-medium focus-within:border-aksen ${labels.length ? "lg:col-span-3" : "lg:col-span-1"}`}>
            <legend className="sr-only">Rentang tanggal</legend>
            <CalendarRange size={16} strokeWidth={1.75} className="mr-1 shrink-0 text-teks-pelan" aria-hidden />
            <label className="sr-only" htmlFor="f-dari">Dari tanggal</label>
            <input id="f-dari" type="date" name="dari" defaultValue={sp.dari} className="min-w-0 flex-1 border-0 bg-transparent py-2 outline-offset-0 lg:w-[150px] lg:flex-none" />
            <span aria-hidden className="text-teks-pelan">–</span>
            <label className="sr-only" htmlFor="f-sampai">Sampai tanggal</label>
            <input id="f-sampai" type="date" name="sampai" defaultValue={sp.sampai} className="min-w-0 flex-1 border-0 bg-transparent py-2 pl-2 outline-offset-0 lg:w-[150px] lg:flex-none" />
          </fieldset>
          <div className="col-span-2 flex gap-2 lg:col-span-1">
            <button type="submit" className={`${buttonClass("utama")} flex-1`}>Terapkan</button>
            {filtered && <ButtonLink href="/transaksi" variant="teks" aria-label="Hapus filter"><X size={18} aria-hidden /><span className="lg:sr-only">Hapus</span></ButtonLink>}
          </div>
        </form>
      </div>
      <Card className="overflow-hidden p-0">
        {failed || !result ? (
          failed ? <ErrorState retryHref={keep({})} /> : <EmptyState title="Filter tidak valid" action={<ButtonLink href="/transaksi" variant="sekunder">Hapus filter</ButtonLink>} />
        ) : result.items.length === 0 ? (
          filtered ? (
            <EmptyState title="Tidak ada transaksi yang cocok" action={<ButtonLink href="/transaksi" variant="sekunder">Hapus filter</ButtonLink>} />
          ) : (
            <EmptyState title="Belum ada transaksi." body="Catat yang pertama atau hubungkan Gmail." action={<ButtonLink href="/tambah/pengeluaran">Catat transaksi pertama</ButtonLink>} />
          )
        ) : (
          <>
            <TxList rows={result.items} emptyText="" grouped />
            <LoadMore query={apiQuery} cursor={result.next_cursor} />
          </>
        )}
      </Card>
    </>
  );
}

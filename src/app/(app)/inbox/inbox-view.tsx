"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeftRight, Check, ChevronLeft, CircleCheck, Mail, Receipt, Sparkles } from "lucide-react";
import { acceptProposal, confirmReview, ignoreReview, rejectProposal, undoReview } from "@/app/actions/review";
import type { InboxFilter, InboxItem } from "@/lib/server/inbox";
import { txCategory, txLabels, txTitle } from "@/components/tx-list";
import { LabelPicker } from "@/components/label-picker";
import { convertToTransfer, updateTransaction } from "@/app/actions/transactions";
import { ActButton } from "@/components/act-button";
import { BigAmount, Button, ButtonLink, CategoryTile, Segmented, TxAmount, cx } from "@/components/ui";
import { toast } from "@/components/toast";
import { formatDayMonth, formatLongDate, formatTime } from "@/lib/core/dates";
import { formatRupiah, formatThousands } from "@/lib/core/money";
import { SURE_CONFIDENCE } from "@/lib/core/domain";
import { BulkSuggest, bulkable } from "./bulk-suggest";

interface Cat { id: string; name: string; icon_key: string; tone_key: string; kind: string }
type Result = { ok: true } | { error: { message: string } };

type LabelOpt = { id: string; name: string; auto_one_off: boolean };

/** "Sejak kemarin 2 transaksi baru dari email, 0 langsung tercatat tanpa dicek" — new vs. auto-confirmed are different numbers. */
const sinceText = (fresh: number, auto: number) =>
  fresh === 0 ? "Belum ada transaksi baru dari email sejak kemarin" : `Sejak kemarin ${fresh} transaksi baru dari email, ${auto} langsung tercatat tanpa dicek`;

export function InboxView({ items: initial, categories, accounts, labels, filter, counts, autoCount, newCount, focusKey }: {
  items: InboxItem[];
  categories: Cat[];
  accounts: { id: string; name: string; is_system: boolean }[];
  labels: LabelOpt[];
  filter: InboxFilter;
  counts: Record<InboxFilter, number>;
  autoCount: number;
  newCount: number; // automatic transactions created since yesterday, whatever their status now
  focusKey?: string;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState(initial);
  const [sel, setSel] = useState(() => Math.max(0, initial.findIndex((i) => i.key === focusKey)));
  const [cat, setCat] = useState<Record<string, string | null>>({});
  const [acc, setAcc] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(true);
  const [, start] = useTransition();
  const [total, setTotal] = useState(initial.length);
  const [seen, setSeen] = useState(initial);
  // server data changed (another screen, refresh on focus): adopt it during render
  if (seen !== initial) {
    setSeen(initial);
    setQueue(initial);
    setTotal(Math.max(total, initial.length));
  }
  useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  const item = queue[Math.min(sel, queue.length - 1)];
  const listRef = useRef<HTMLUListElement>(null);
  // keyboard selection: keep the selected row visible and move focus with it, so ring and highlight never disagree
  useEffect(() => {
    const btn = listRef.current?.children[Math.min(sel, queue.length - 1)]?.querySelector("button");
    if (!btn) return;
    btn.scrollIntoView({ block: "nearest" });
    if (listRef.current?.contains(document.activeElement)) btn.focus({ preventScroll: true });
  }, [sel, queue.length]);
  const done = total - queue.length;

  const remove = useCallback((key: string) => {
    setQueue((q) => q.filter((x) => x.key !== key));
  }, []);

  const runOptimistic = useCallback(
    (it: InboxItem, fn: () => Promise<Result>, okText?: string, undo?: () => Promise<Result>) => {
      const snapshot = queue;
      remove(it.key);
      start(async () => {
        const r = await fn().catch(() => ({ error: { message: "Tidak ada koneksi. Aksi belum tersimpan." } }));
        if ("error" in r) {
          setQueue(snapshot);
          return toast({ text: r.error.message, tone: "galat" });
        }
        if (okText) toast({ text: okText, ms: undo ? 6000 : undefined, action: undo ? { label: "Urungkan", run: () => void undo().then(() => router.refresh()) } : undefined });
        router.refresh();
      });
    },
    [queue, remove, router],
  );

  const chosenCategory = (it: InboxItem) => (it.key in cat ? cat[it.key] : (it.tx.category_id ?? it.suggestion?.category_id ?? null));
  const systemIds = useMemo(() => new Set(accounts.filter((a) => a.is_system).map((a) => a.id)), [accounts]);
  const bulk = (
    <BulkSuggest items={queue.filter((it) => bulkable(it, systemIds))} categories={categories}
      onDone={(keys) => setQueue((q) => q.filter((x) => !keys.includes(x.key)))} />
  );
  const chosenAccount = (it: InboxItem) => acc[it.key] ?? it.tx.account_id;
  const needsCategory = (it: InboxItem) => !it.topUpTo && ["expense", "income", "fee"].includes(it.tx.kind) && !["transfer", "repayment"].includes(it.proposals[0]?.type ?? "");
  const topUps = queue.filter((it) => it.topUpTo);
  const topUpSummary = [...topUps.reduce((m, it) => m.set(it.topUpTo!.name, (m.get(it.topUpTo!.name) ?? 0) + 1), new Map<string, number>())]
    .map(([name, n]) => `${name} ${n}×`).join(" · ");
  const bulkTopUp = topUps.length > 1 && (
    <ActButton variant="lembut" done={`${topUps.length} isi saldo dijadikan transfer.`}
      action={() => convertToTransfer(topUps.map((it) => ({ transaction_id: it.tx.id, to_account_id: it.topUpTo!.id })))}
      confirm={{
        title: `Jadikan ${topUps.length} isi saldo sebagai transfer?`,
        body: `${topUpSummary}. Uangnya pindah ke e-wallet milikmu, jadi tidak lagi dihitung sebagai pengeluaran.`,
        verb: "Jadikan transfer",
      }}>
      <ArrowLeftRight size={16} aria-hidden />Isi saldo e-wallet ({topUps.length})
    </ActButton>
  );
  const systemAccount = (it: InboxItem) => accounts.find((a) => a.id === chosenAccount(it))?.is_system ?? false;

  const confirm = useCallback(
    (it: InboxItem) => {
      if (systemAccount(it)) return toast({ text: "Pilih akun dulu.", tone: "galat" });
      if (it.topUpTo) {
        const to = it.topUpTo;
        return runOptimistic(it, () => convertToTransfer([{ transaction_id: it.tx.id, to_account_id: to.id }]), `Dijadikan transfer ke ${to.name}.`);
      }
      const p = it.proposals[0];
      const category = chosenCategory(it);
      if (needsCategory(it) && !category) return toast({ text: "Pilih kategori dulu.", tone: "galat" });
      runOptimistic(it, async () => {
        if (p && p.type !== "receipt_link") return acceptProposal(p.id);
        if (p) {
          const r = await acceptProposal(p.id);
          if ("error" in r) return r;
        }
        return confirmReview({ transaction_id: it.tx.id, category_id: category, account_id: chosenAccount(it), remember, expected_updated_at: it.tx.updated_at });
      }, it.groupCount > 1 ? `${it.groupCount} transaksi dikonfirmasi.` : "Dikonfirmasi.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cat, acc, remember, runOptimistic],
  );
  const skip = useCallback((it: InboxItem) => setQueue((q) => [...q.filter((x) => x.key !== it.key), it]), []);
  const ignore = useCallback(
    (it: InboxItem) => {
      const p = it.proposals[0];
      if (p && it.tx.status !== "needs_review") return runOptimistic(it, () => rejectProposal(p.id), "Usulan ditolak.");
      runOptimistic(it, async () => {
        if (p) await rejectProposal(p.id);
        return ignoreReview(it.tx.id);
      }, "Diabaikan.", () => undoReview(it.tx.id));
    },
    [runOptimistic],
  );

  // desktop shortcuts (not while typing)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // a focused button or link keeps its own Enter; only the item list and the page itself take shortcuts
      if (target.closest("input, textarea, select, [data-no-shortcuts]") || (target.closest("button, a") && !listRef.current?.contains(target))) return;
      if (document.querySelector("dialog[open]") || !item) return;
      if (e.key === "Enter") { e.preventDefault(); confirm(item); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(queue.length - 1, s + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key.toLowerCase() === "e") router.push(`/transaksi/${item.tx.id}`);
      else if (e.key.toLowerCase() === "s") skip(item);
      else if (e.key.toLowerCase() === "x") ignore(item);
    };
    if (window.matchMedia("(min-width: 1024px)").matches) window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [item, queue.length, confirm, skip, ignore, router]);

  const filters = (
    <Segmented
      label="Saring Inbox"
      value={filter}
      hrefFor={(v) => (v === "semua" ? "/inbox" : `/inbox?filter=${v}`)}
      options={[
        { value: "semua", label: "Semua", count: counts.semua },
        { value: "cocok", label: "Cocok", count: counts.cocok },
        { value: "merchant_baru", label: "Merchant baru", count: counts.merchant_baru },
        { value: "belum_terkait", label: "Belum terkait", count: counts.belum_terkait },
      ]}
    />
  );

  if (!item) {
    return (
      <>
        <div className="mb-4 hidden lg:block">{filters}</div>
        <div className="flex flex-col items-center gap-3 rounded-kartu bg-permukaan px-6 py-14 text-center shadow-e2">
          <CircleCheck size={32} strokeWidth={1.75} className="text-aksen" aria-hidden />
          <h2 className="text-[20px] font-bold">Semua sudah ditinjau</h2>
          <p className="text-[14px] text-teks-redup">{sinceText(newCount, autoCount)}.</p>
          <ButtonLink href="/transaksi?status=auto_confirmed" variant="lembut">Lihat transaksi otomatis</ButtonLink>
        </div>
      </>
    );
  }

  return (
    <>
      {/* mobile: one card at a time */}
      <div className="lg:hidden">
        <div className="mb-3 flex items-center justify-between">
          <Link href="/" aria-label="Kembali" className="-ml-2 flex h-11 w-11 items-center justify-center"><ChevronLeft size={26} aria-hidden /></Link>
          <h1 className="flex-1 text-[24px] font-bold">Inbox</h1>
          <p className="tabular text-[15px] text-teks-redup">{Math.min(done + 1, total)} dari {total}</p>
        </div>
        <div className="mb-4 flex gap-1.5" aria-hidden>
          {Array.from({ length: Math.min(total, 12) }, (_, i) => (
            <span key={i} className={cx("h-1 flex-1 rounded-full", i < done ? "bg-aksen-sedang" : i === done ? "bg-aksen" : "bg-garis")} />
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-2 empty:hidden">{bulk}{bulkTopUp}</div>
        <SwipeCard onRight={() => confirm(item)} onLeft={() => skip(item)}>
          <Detail it={item} compact categories={categories} accounts={accounts} cat={chosenCategory(item)} setCat={(v) => setCat({ ...cat, [item.key]: v })}
            acc={chosenAccount(item)} setAcc={(v) => setAcc({ ...acc, [item.key]: v })} needsCategory={needsCategory(item)} labels={labels} />
        </SwipeCard>
        {queue[1] && (
          <div className="mx-3 -mt-2 flex justify-between rounded-b-kartu bg-permukaan px-5 pt-4 pb-2 text-[14px] text-teks-redup shadow-e1">
            <span className="truncate">Berikutnya · {queue[1].title}</span>
            <TxAmount amount={Number(queue[1].tx.amount)} direction={queue[1].tx.direction} />
          </div>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <Button full onClick={() => confirm(item)}>{item.topUpTo ? `Jadikan transfer ke ${item.topUpTo.name}` : "Konfirmasi"}</Button>
          <div className="grid grid-cols-4 gap-1">
            <ButtonLink variant="teks" href={`/transaksi/${item.tx.id}`}>Ubah</ButtonLink>
            <ButtonLink variant="teks" href={`/bagi/baru?transaksi=${item.tx.id}`}>Bagi</ButtonLink>
            <Button variant="teks" onClick={() => skip(item)}>Lewati</Button>
            <Button variant="teks" onClick={() => ignore(item)}>{item.proposals[0] && item.tx.status !== "needs_review" ? "Tolak" : "Abaikan"}</Button>
          </div>
        </div>
      </div>

      {/* desktop: list + detail */}
      <div className="hidden lg:block">
        <header className="mb-5">
          <h1 className="text-[28px] font-bold">Inbox</h1>
          <p className="text-[15px] text-teks-redup">{counts.semua} perlu dicek · {sinceText(newCount, autoCount)}</p>
        </header>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">{filters}<div className="flex flex-wrap gap-2">{bulkTopUp}{bulk}</div></div>
        <div className="grid grid-cols-[minmax(320px,400px)_1fr] gap-6">
          <ul ref={listRef} aria-label="Item perlu dicek" className="flex max-h-[calc(100dvh-220px)] flex-col overflow-y-auto rounded-kartu bg-permukaan p-2 shadow-e2">
            {queue.map((it, i) => {
              const c = txCategory(it.tx);
              return (
                <li key={it.key}>
                  <button type="button" onClick={() => setSel(i)} aria-current={i === Math.min(sel, queue.length - 1) ? "true" : undefined}
                    className={cx("flex w-full items-center gap-3 rounded-strip px-3 py-3 text-left", i === Math.min(sel, queue.length - 1) ? "bg-aksen-lembut" : "hover:bg-latar")}>
                    <CategoryTile icon={c.icon_key} tone={c.tone_key} size={40} name={txTitle(it.tx)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{it.title}</span>
                      <span className="block truncate text-[13px] text-teks-redup">
                        {it.subtitle}
                        {it.suggestion && <span className="text-aksen"> · {it.suggestion.is_transfer ? "mungkin transfer" : `saran: ${categories.find((c) => c.id === it.suggestion?.category_id)?.name}`}</span>}
                      </span>
                    </span>
                    <TxAmount amount={Number(it.tx.amount)} direction={it.tx.direction} />
                  </button>
                </li>
              );
            })}
          </ul>
          <section aria-label="Detail item" className="rounded-kartu bg-permukaan p-7 shadow-e3">
            <Detail it={item} categories={categories} accounts={accounts} cat={chosenCategory(item)} setCat={(v) => setCat({ ...cat, [item.key]: v })}
              acc={chosenAccount(item)} setAcc={(v) => setAcc({ ...acc, [item.key]: v })} needsCategory={needsCategory(item)} labels={labels} />
            {needsCategory(item) && item.tx.merchant_id && (
              <label className="mt-4 flex min-h-11 items-center gap-3 text-[15px]">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-5 w-5 accent-aksen" />
                Ingat kategori ini untuk {item.title}
              </label>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-garis pt-6">
              <Button onClick={() => confirm(item)}>{item.topUpTo ? `Jadikan transfer ke ${item.topUpTo.name}` : "Konfirmasi"}</Button>
              <ButtonLink variant="sekunder" href={`/transaksi/${item.tx.id}`}>Ubah</ButtonLink>
              <ButtonLink variant="sekunder" href={`/bagi/baru?transaksi=${item.tx.id}`}>Bagi tagihan</ButtonLink>
              <Button variant="teks" onClick={() => skip(item)}>Lewati</Button>
              <Button variant="teks" onClick={() => ignore(item)}>{item.proposals[0] && item.tx.status !== "needs_review" ? "Tolak usulan" : "Abaikan"}</Button>
            </div>
            <p className="mt-3 text-right text-[13px] text-teks-pelan">Enter untuk konfirmasi · panah bawah untuk berikutnya · E ubah · S lewati · X abaikan</p>
          </section>
        </div>
      </div>
    </>
  );
}

function Detail({ it, compact, categories, accounts, cat, setCat, acc, setAcc, needsCategory, labels }: {
  it: InboxItem; compact?: boolean; categories: Cat[]; accounts: { id: string; name: string; is_system: boolean }[];
  cat: string | null | undefined; setCat: (v: string) => void; acc: string; setAcc: (v: string) => void; needsCategory: boolean; labels: LabelOpt[];
}) {
  const p = it.proposals[0];
  const c = txCategory(it.tx);
  const receipt = p?.receipt;
  const kindCats = useMemo(() => categories.filter((x) => x.kind === (it.tx.kind === "income" ? "income" : "expense")), [categories, it.tx.kind]);
  const gap = p?.receipt?.occurred_at ? Math.round(Math.abs(Date.parse(p.receipt.occurred_at) - Date.parse(it.tx.occurred_at)) / 1000) : null;
  const evidenceText = p?.type === "receipt_link" ? "Email + nota cocok" : (it.tx.transaction_evidence?.length ?? 0) >= 2 ? "Email + nota cocok" : it.tx.source === "receipt" ? "Nota saja" : "Email";
  const accountRow = (
    <div className="flex items-center gap-3">
      <label htmlFor={`${compact ? "m" : "d"}-akun-${it.key}`} className="sr-only">Akun</label>
      <select id={`${compact ? "m" : "d"}-akun-${it.key}`} value={acc} onChange={(e) => setAcc(e.target.value)} className="min-h-11 rounded-petak border border-garis-kontrol bg-permukaan px-3 font-semibold">
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {accounts.find((a) => a.id === acc)?.is_system && <span className="text-[13px] text-galat">Pilih akun dulu.</span>}
    </div>
  );
  return (
    <div>
      <div className="flex items-start gap-4">
        <CategoryTile icon={c.icon_key} tone={c.tone_key} size={52} name={txTitle(it.tx)} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-bold">{it.title}</h2>
          <p className="text-[14px] text-teks-redup">{compact ? formatDayMonth(it.tx.occurred_at) : formatLongDate(it.tx.occurred_at)} · {formatTime(it.tx.occurred_at).replace(" WIB", "")} · {accounts.find((a) => a.id === it.tx.account_id)?.name}</p>
          {it.groupCount > 1 && <p className="mt-1 text-[13px] font-semibold text-aksen">{it.groupCount} transaksi dari merchant ini</p>}
        </div>
        {!compact && <BigAmount value={Number(it.tx.amount)} sign={it.tx.direction === "in" ? "+" : "−"} />}
      </div>
      {compact && <div className="mt-5"><BigAmount value={Number(it.tx.amount)} sign={it.tx.direction === "in" ? "+" : "−"} /></div>}

      {compact ? (
        <dl className="mt-5 divide-y divide-garis border-t border-garis text-[15px]">
          <div className="flex gap-4 py-3"><dt className="w-20 text-teks-redup">Bukti</dt><dd><span className="flex items-center gap-1.5 font-semibold"><CircleCheck size={16} className="text-aksen" aria-hidden />{evidenceText}</span>{gap != null && <span className="text-[13px] text-teks-redup">Nominal sama, selisih {gap} detik</span>}</dd></div>
          {receipt && <div className="flex gap-4 py-3"><dt className="w-20 text-teks-redup">Rincian</dt><dd><span className="font-semibold">{receipt.receipt_items.length} item dari nota</span><span className="block text-[13px] text-teks-redup">Subtotal {formatThousands(Number(receipt.subtotal ?? 0))}{Number(receipt.tax_amount) ? ` + pajak ${formatThousands(Number(receipt.tax_amount))}` : ""}</span></dd></div>}
          {p && p.type !== "receipt_link" && <div className="flex gap-4 py-3"><dt className="w-20 text-teks-redup">Usulan</dt><dd className="font-semibold">{it.subtitle}{p.fee_amount ? ` · biaya ${formatRupiah(p.fee_amount)}` : ""}</dd></div>}
          <div className="flex items-center gap-4 py-3"><dt className="w-20 text-teks-redup">Akun</dt><dd>{accountRow}</dd></div>
        </dl>
      ) : (
        <div className="mt-6">
          <h3 className="mb-3 text-[14px] font-semibold text-teks-redup">Bukti</h3>
          <div className="grid grid-cols-2 gap-8">
            <div className="text-[14px]">
              <p className="mb-2 flex items-center gap-2 font-semibold">{it.tx.source === "receipt" ? <Receipt size={16} aria-hidden /> : <Mail size={16} aria-hidden />}{it.tx.source === "receipt" ? "Nota" : "Email"}</p>
              <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 border-t border-garis pt-2">
                <dt className="text-teks-redup">Nominal</dt><dd className="tabular">{formatRupiah(Number(it.tx.amount))}</dd>
                <dt className="text-teks-redup">Waktu</dt><dd className="tabular">{formatTime(it.tx.occurred_at, true)}</dd>
                <dt className="text-teks-redup">Penerima</dt><dd>{it.tx.merchant_raw ?? "—"}</dd>
              </dl>
            </div>
            {receipt ? (
              <div className="text-[14px]">
                <p className="mb-2 flex items-center gap-2 font-semibold"><Receipt size={16} aria-hidden />Nota{receipt.occurred_at ? ` · ${formatTime(receipt.occurred_at).replace(" WIB", "")}` : ""}</p>
                <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 border-t border-garis pt-2">
                  {[...receipt.receipt_items].sort((a, b) => a.position - b.position).map((x, i) => <div key={i} className="contents"><dt>{x.name}</dt><dd className="tabular text-right">{formatThousands(Number(x.line_total))}</dd></div>)}
                  <dt className="text-teks-redup">Subtotal</dt><dd className="tabular text-right">{formatThousands(Number(receipt.subtotal ?? 0))}</dd>
                  {Number(receipt.tax_amount) > 0 && <><dt className="text-teks-redup">Pajak{receipt.tax_rate_pct ? ` ${receipt.tax_rate_pct}%` : ""}</dt><dd className="tabular text-right">{formatThousands(Number(receipt.tax_amount))}</dd></>}
                  <dt className="font-semibold">Total</dt><dd className="tabular text-right font-semibold">{formatThousands(Number(receipt.total))}</dd>
                </dl>
              </div>
            ) : <div className="text-[14px]"><p className="mb-2 font-semibold">Akun</p>{accountRow}</div>}
          </div>
          {p && (
            <p className="mt-5 flex gap-2 rounded-strip bg-aksen-lembut p-4 text-[14px] text-aksen">
              <CircleCheck size={18} className="mt-0.5 shrink-0" aria-hidden />
              {p.type === "receipt_link" && `Cocok: nominal sama${gap != null ? ` dan selisih waktu ${gap} detik` : ""}. Nama di email bisa berbeda dari nama di nota, jadi pencocokan tidak memakai nama.`}
              {p.type === "transfer" && `Tampak seperti transfer antar akun${p.fee_amount ? ` dengan biaya admin ${formatRupiah(p.fee_amount)}` : ""}. Konfirmasi agar tidak dihitung sebagai pengeluaran.`}
              {p.type === "repayment" && p.receivable && `Cocok dengan piutang ${p.receivable.person_name} (sisa ${formatRupiah(Number(p.receivable.remaining))}). Konfirmasi agar tidak dihitung sebagai pemasukan.`}
              {p.type === "duplicate_suspect" && "Ada transaksi dengan jumlah dan waktu yang sama di akun lain. Konfirmasi bila ini transaksi yang sama."}
            </p>
          )}
          {receipt && <div className="mt-4">{accountRow}</div>}
        </div>
      )}

      {it.suggestion && !it.topUpTo && <SuggestionNote it={it} compact={compact} />}
      {it.topUpTo && (
        <p className={cx("flex gap-2 rounded-strip bg-aksen-lembut p-3 text-[14px] text-aksen", compact ? "mt-3" : "mt-5")}>
          <ArrowLeftRight size={18} className="mt-0.5 shrink-0" aria-hidden />
          Isi saldo ke akun {it.topUpTo.name} milikmu. Jadikan transfer agar tidak dihitung sebagai pengeluaran; saldo {it.topUpTo.name} ikut bertambah.
        </p>
      )}
      {needsCategory && compact && (
        <div className="flex items-center gap-4 border-t border-garis py-3 text-[15px]">
          <label htmlFor={`kategori-${it.key}`} className="w-20 text-teks-redup">Kategori</label>
          <select id={`kategori-${it.key}`} value={cat ?? ""} onChange={(e) => setCat(e.target.value)} className="min-h-11 flex-1 rounded-petak border border-garis-kontrol bg-permukaan px-3 font-semibold">
            <option value="" disabled>Pilih kategori</option>
            {kindCats.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </div>
      )}
      {needsCategory && !compact && (
        <fieldset className="mt-5">
          <legend className="mb-2 text-[14px] font-semibold text-teks-redup">Kategori</legend>
          <div className="flex flex-wrap gap-2">
            {kindCats.map((k) => (
              <button key={k.id} type="button" aria-pressed={cat === k.id} onClick={() => setCat(k.id)}
                className={cx("inline-flex min-h-11 items-center gap-2 rounded-full border py-1 pr-4 pl-1.5 text-[14px] font-semibold transition-colors duration-cepat",
                  cat === k.id ? "border-aksen bg-aksen-lembut text-aksen ring-1 ring-aksen" : "border-garis hover:border-garis-kontrol hover:bg-latar")}>
                {cat === k.id ? <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-aksen text-white"><Check size={16} aria-hidden /></span>
                  : <CategoryTile icon={k.icon_key} tone={k.tone_key} size={32} />}
                {k.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className={cx("grid gap-3 text-[15px]", compact ? "border-t border-garis py-3" : "mt-5 lg:grid-cols-[1fr_1fr] lg:gap-6")}>
        <div className={cx(compact && "flex items-center gap-4")}>
          <p className={cx("text-teks-redup", compact ? "w-20 shrink-0" : "mb-2 text-[14px] font-semibold")}>Label</p>
          <LabelPicker key={it.tx.id} transactionId={it.tx.id} value={txLabels(it.tx)} labels={labels} />
        </div>
        <NoteField key={`${it.tx.id}-${it.tx.updated_at}`} it={it} compact={compact} />
      </div>
    </div>
  );
}

/** F-08.4: a note saved when the field loses focus; the Inbox shortcuts are off while typing in it. */
function NoteField({ it, compact }: { it: InboxItem; compact?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(it.tx.note ?? "");
  const [, start] = useTransition();
  const save = () => {
    const note = v.trim();
    if (note === (it.tx.note ?? "")) return;
    start(async () => {
      const r = await updateTransaction({ id: it.tx.id, expected_updated_at: it.tx.updated_at, note: note || null })
        .catch(() => ({ error: { message: "Tidak ada koneksi. Catatan belum tersimpan." } }));
      if ("error" in r) return toast({ text: r.error.message, tone: "galat" });
      toast({ text: "Catatan disimpan." });
      router.refresh();
    });
  };
  return (
    <div className={cx(compact && "flex items-center gap-4")}>
      <label htmlFor={`${compact ? "m" : "d"}-catatan-${it.key}`} className={cx("block text-teks-redup", compact ? "w-20 shrink-0" : "mb-2 text-[14px] font-semibold")}>Catatan</label>
      <input id={`${compact ? "m" : "d"}-catatan-${it.key}`} value={v} maxLength={500} onChange={(e) => setV(e.target.value)} onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder="Misalnya: pelunasan umroh lewat kakak"
        className="min-h-10 w-full min-w-0 rounded-petak border border-garis-kontrol bg-permukaan px-3 text-[14px] placeholder:text-teks-pelan" />
    </div>
  );
}

/** Swipe right 80 px = confirm, left 80 px = skip. Buttons below are the one-pointer alternative. */
function SwipeCard({ children, onRight, onLeft }: { children: React.ReactNode; onRight: () => void; onLeft: () => void }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className="relative touch-pan-y rounded-kartu bg-permukaan p-5 shadow-e3 transition-transform duration-sedang ease-standar"
      style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 40}deg)` : undefined, transitionDuration: dragging ? "0ms" : undefined }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button, select, a, input")) return;
        start.current = { x: e.clientX, y: e.clientY };
        setDragging(true);
      }}
      onPointerMove={(e) => start.current && setDx(e.clientX - start.current.x)}
      onPointerUp={() => {
        if (dx >= 80) onRight();
        else if (dx <= -80) onLeft();
        start.current = null;
        setDragging(false);
        setDx(0);
      }}
      onPointerCancel={() => { start.current = null; setDragging(false); setDx(0); }}
    >
      {children}
    </div>
  );
}

/** 8.3: says where the preselected category came from, or warns that this may be a top-up/own transfer. */
function SuggestionNote({ it, compact }: { it: InboxItem; compact?: boolean }) {
  const sg = it.suggestion!;
  if (sg.is_transfer)
    return (
      <p className={cx("flex gap-2 rounded-strip bg-peringatan-latar p-3 text-[14px] text-peringatan", compact ? "mt-3" : "mt-5")}>
        <ArrowLeftRight size={18} className="mt-0.5 shrink-0" aria-hidden />
        Saran AI: kemungkinan isi saldo e-wallet atau transfer ke akun sendiri, bukan pengeluaran. Buka Ubah untuk menjadikannya transfer.
      </p>
    );
  return (
    <p className={cx("flex items-center gap-2 text-[13px] font-semibold text-aksen", compact ? "mt-3" : "mt-5 -mb-2")}>
      <Sparkles size={16} aria-hidden />
      Kategori diisi dari saran AI · {sg.confidence >= SURE_CONFIDENCE ? "yakin" : "ragu, periksa dulu"}
    </p>
  );
}

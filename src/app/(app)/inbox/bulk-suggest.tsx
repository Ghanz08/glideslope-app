"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { confirmSuggestions } from "@/app/actions/review";
import type { InboxItem } from "@/lib/server/inbox";
import { txTitle } from "@/components/tx-list";
import { Button, CategoryTile, cx } from "@/components/ui";
import { toast } from "@/components/toast";
import { SURE_CONFIDENCE } from "@/lib/core/domain";
import { formatRupiah } from "@/lib/core/money";

interface Cat { id: string; name: string; icon_key: string; tone_key: string; kind: string }

/** Items the owner can confirm straight from an AI suggestion: a new merchant with a suggested category and a real account. */
export const bulkable = (it: InboxItem, systemAccountIds: Set<string>) =>
  !!it.suggestion?.category_id && it.tx.review_reason === "merchant_baru" && !it.proposals.length && !systemAccountIds.has(it.tx.account_id);

/**
 * 8.3: the owner reviews AI suggestions in one list and confirms them. Sure ones start ticked, unsure ones don't;
 * each category can be changed before confirming. Confirming remembers the category for the merchant.
 */
export function BulkSuggest({ items, categories, onDone }: { items: InboxItem[]; categories: Cat[]; onDone: (keys: string[]) => void }) {
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const [pick, setPick] = useState<Record<string, string | null>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const expense = categories.filter((c) => c.kind === "expense");
  const catOf = (it: InboxItem) => (it.key in pick ? pick[it.key] : (it.suggestion!.confidence >= SURE_CONFIDENCE ? it.suggestion!.category_id : null));
  const chosen = items.filter((it) => catOf(it));
  const txCount = chosen.reduce((a, it) => a + it.groupCount, 0);
  if (!items.length) return null;

  const run = async () => {
    setProgress(chosen.length);
    const r = await confirmSuggestions(
      chosen.map((it) => ({ transaction_id: it.tx.id, category_id: catOf(it)!, account_id: it.tx.account_id, expected_updated_at: it.tx.updated_at })),
    ).catch(() => ({ error: { message: "Tidak ada koneksi. Belum ada yang dikonfirmasi." } }));
    setProgress(null);
    if ("error" in r) return toast({ text: r.error.message, tone: "galat" });
    dlg.current?.close();
    const ok = new Set(r.confirmed);
    onDone(chosen.filter((it) => ok.has(it.tx.id)).map((it) => it.key));
    toast(r.failed
      ? { text: `${r.confirmed.length} merchant dikonfirmasi, ${r.failed} gagal karena sudah berubah. Buka lagi untuk sisanya.`, tone: "galat" }
      : { text: `${r.confirmed.length} merchant dikonfirmasi; kategorinya diingat untuk transaksi berikutnya.` });
    router.refresh();
  };

  return (
    <>
      <Button variant="lembut" onClick={() => { setPick({}); dlg.current?.showModal(); }}>
        <Sparkles size={16} aria-hidden />Tinjau saran AI ({items.length})
      </Button>
      <dialog ref={dlg} aria-labelledby="saran-judul" className="m-auto w-[min(640px,calc(100%-32px))] overflow-hidden rounded-kartu bg-permukaan p-0 shadow-e3">
        <div className="flex max-h-[min(760px,calc(100dvh-32px))] flex-col">
        <header className="border-b border-garis px-6 pt-6 pb-4">
          <h2 id="saran-judul" className="flex items-center gap-2 text-[18px] font-bold"><Sparkles size={18} className="text-aksen" aria-hidden />Saran kategori dari AI</h2>
          <p className="mt-1 text-[14px] text-teks-redup">
            Yang yakin sudah dicentang. Periksa sekilas, ganti kategori yang keliru, lalu konfirmasi. Kategori akan diingat untuk merchant itu.
          </p>
        </header>
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {items.map((it) => {
            const sel = catOf(it);
            const sure = it.suggestion!.confidence >= SURE_CONFIDENCE;
            return (
              <li key={it.key} className={cx("flex items-center gap-3 rounded-strip px-3 py-2.5", sel ? "" : "opacity-70")}>
                <input type="checkbox" aria-label={`Sertakan ${txTitle(it.tx)}`} checked={!!sel} className="h-5 w-5 shrink-0 accent-aksen"
                  onChange={(e) => setPick({ ...pick, [it.key]: e.target.checked ? it.suggestion!.category_id : null })} />
                <CategoryTile icon={null} size={36} name={txTitle(it.tx)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{txTitle(it.tx)}</span>
                  <span className="block text-[13px] text-teks-redup">
                    {it.groupCount > 1 ? `${it.groupCount} transaksi · ` : ""}{formatRupiah(Number(it.tx.amount))}
                    {!sure && <span className="font-semibold text-peringatan"> · AI ragu</span>}
                  </span>
                </span>
                <label className="sr-only" htmlFor={`saran-${it.key}`}>Kategori {txTitle(it.tx)}</label>
                <select id={`saran-${it.key}`} value={sel ?? it.suggestion!.category_id ?? ""} className="min-h-10 w-40 shrink-0 rounded-petak border border-garis-kontrol bg-permukaan pl-3 text-[14px] font-medium sm:w-48"
                  onChange={(e) => setPick({ ...pick, [it.key]: e.target.value })}>
                  {expense.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </li>
            );
          })}
        </ul>
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-garis px-6 py-4">
          <p className="mr-auto text-[13px] text-teks-redup" aria-live="polite">
            {progress != null ? `Mengonfirmasi ${progress} merchant…` : `${chosen.length} merchant · ${txCount} transaksi`}
          </p>
          <Button variant="sekunder" onClick={() => dlg.current?.close()} disabled={progress != null}>Batal</Button>
          <Button onClick={run} disabled={!chosen.length || progress != null}>Konfirmasi {chosen.length}</Button>
        </footer>
        </div>
      </dialog>
    </>
  );
}

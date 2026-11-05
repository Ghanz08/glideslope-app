"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import { Check, Plus, Tag, X } from "lucide-react";
import { saveLabel, setTransactionLabels } from "@/app/actions/labels";
import { toast } from "./toast";
import { cx } from "./ui";

interface L { id: string; name: string; auto_one_off: boolean }

/**
 * F-08.4: attach labels to one transaction. Type to filter, or to create a new label on the spot.
 * Labels marked "acara khusus" also mark the transaction one-off (done on the server).
 */
export function LabelPicker({ transactionId, value, labels }: { transactionId: string; value: { id: string; name: string }[]; labels: L[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [pending, start] = useTransition();
  const [sel, setSel] = useOptimistic(value);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const apply = (next: { id: string; name: string }[], doneText?: string) =>
    start(async () => {
      setSel(next);
      const r = await setTransactionLabels(transactionId, next.map((l) => l.id)).catch(() => ({ error: { message: "Tidak ada koneksi. Label belum tersimpan." } }));
      if ("error" in r) return toast({ text: r.error.message, tone: "galat" });
      if (doneText) toast({ text: doneText });
      router.refresh();
    });

  const toggle = (l: L) => {
    const on = sel.some((x) => x.id === l.id);
    apply(on ? sel.filter((x) => x.id !== l.id) : [...sel, { id: l.id, name: l.name }], !on && l.auto_one_off ? `Label ${l.name}: transaksi ditandai sekali-jalan.` : undefined);
  };

  const create = () =>
    start(async () => {
      const name = term.trim();
      const r = await saveLabel({ name, auto_one_off: false, target_amount: null }).catch(() => ({ error: { message: "Tidak ada koneksi. Label belum dibuat." } }));
      if ("error" in r) return toast({ text: r.error.message, tone: "galat" });
      setTerm("");
      apply([...sel, { id: r.id, name }], `Label ${name} dibuat. Atur target atau sekali-jalan di halaman Label.`);
    });

  const q = term.trim().toLowerCase();
  const shown = labels.filter((l) => !q || l.name.toLowerCase().includes(q));
  const exact = labels.some((l) => l.name.toLowerCase() === q);

  return (
    <div ref={box} data-no-shortcuts className="relative flex flex-wrap items-center gap-1.5">
      {sel.map((l) => (
        <span key={l.id} className="inline-flex h-8 items-center gap-1 rounded-full bg-aksen-lembut pr-1 pl-3 text-[13px] font-semibold text-aksen">
          <span aria-hidden className="opacity-60">#</span>{l.name}
          <button type="button" aria-label={`Lepas label ${l.name}`} disabled={pending} onClick={() => apply(sel.filter((x) => x.id !== l.id))}
            className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-aksen-sedang/40">
            <X size={14} aria-hidden />
          </button>
        </span>
      ))}
      <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}
        className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-garis-kontrol px-3 text-[13px] font-semibold text-teks-redup hover:border-aksen hover:text-aksen">
        <Plus size={14} aria-hidden />Label
      </button>
      {open && (
        <div id={listId} className="absolute top-10 left-0 z-[20] w-72 rounded-strip bg-permukaan p-2 shadow-e3"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <label className="sr-only" htmlFor={`${listId}-cari`}>Cari atau buat label</label>
          <input id={`${listId}-cari`} autoFocus value={term} maxLength={40} onChange={(e) => setTerm(e.target.value)} placeholder="Cari atau buat label…"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (q && !exact) create(); else if (shown[0]) toggle(shown[0]); } }}
            className="mb-1 min-h-10 w-full rounded-petak border border-garis-kontrol px-3 text-[14px]" />
          <ul className="max-h-60 overflow-y-auto">
            {shown.map((l) => {
              const on = sel.some((x) => x.id === l.id);
              return (
                <li key={l.id}>
                  <button type="button" role="menuitemcheckbox" aria-checked={on} disabled={pending} onClick={() => toggle(l)}
                    className={cx("flex min-h-10 w-full items-center gap-2 rounded-petak-kecil px-2 text-left text-[14px] hover:bg-latar", on && "font-semibold text-aksen")}>
                    <span className="flex w-4 justify-center">{on ? <Check size={16} aria-hidden /> : <Tag size={14} className="text-teks-pelan" aria-hidden />}</span>
                    <span className="flex-1 truncate">{l.name}</span>
                    {l.auto_one_off && <span className="text-[12px] font-normal text-teks-pelan">sekali-jalan</span>}
                  </button>
                </li>
              );
            })}
            {q && !exact && (
              <li>
                <button type="button" disabled={pending} onClick={create}
                  className="flex min-h-10 w-full items-center gap-2 rounded-petak-kecil px-2 text-left text-[14px] font-semibold text-aksen hover:bg-aksen-lembut">
                  <Plus size={16} aria-hidden />Buat label “{term.trim()}”
                </button>
              </li>
            )}
            {!shown.length && !q && <li className="px-2 py-3 text-[13px] text-teks-redup">Belum ada label. Ketik nama untuk membuat, misalnya “Umroh 2026”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

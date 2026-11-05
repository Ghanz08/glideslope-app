"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveCategory, deleteCategory, mergeMerchant, saveCategory, saveMerchantRule } from "@/app/actions/transactions";
import { Button, CategoryTile, inputClass } from "@/components/ui";
import { toast } from "@/components/toast";

interface Cat { id: string; name: string; kind: string; icon_key: string; tone_key: string; is_system: boolean; archived_at: string | null; used: number }
interface Merchant { id: string; display_name: string; default_category_id: string | null; default_one_off: boolean; skip_review: boolean }

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { error: { message: string; fields?: Record<string, string> } }>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if ("error" in r) return toast({ text: Object.values(r.error.fields ?? {})[0] ?? r.error.message, tone: "galat" });
      if (ok) toast({ text: ok });
      router.refresh();
    });
  return { pending, run };
}

export function Categories({ cats }: { cats: Cat[] }) {
  const { pending, run } = useRun();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col">
        {cats.map((c) => (
          <li key={c.id} className="flex min-h-12 items-center gap-3 border-b border-garis last:border-0">
            <CategoryTile icon={c.icon_key} tone={c.tone_key} size={32} />
            {editing === c.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveCategory({ id: c.id, name: draft, kind: c.kind as "expense", icon_key: c.icon_key, tone_key: c.tone_key }), "Kategori diganti nama."); setEditing(null); }}>
                <label className="sr-only" htmlFor={`cat-${c.id}`}>Nama kategori</label>
                <input id={`cat-${c.id}`} value={draft} maxLength={30} onChange={(e) => setDraft(e.target.value)} className={inputClass()} />
                <Button type="submit" variant="lembut" disabled={pending}>Simpan</Button>
              </form>
            ) : (
              <span className={`flex-1 text-[15px] ${c.archived_at ? "text-teks-pelan line-through" : ""}`}>
                {c.name} <span className="text-[12px] text-teks-pelan">{c.kind === "income" ? "pemasukan" : "pengeluaran"} · {c.used} transaksi</span>
              </span>
            )}
            {editing !== c.id && <Button variant="teks" onClick={() => { setEditing(c.id); setDraft(c.name); }}>Ganti nama</Button>}
            <Button variant="teks" disabled={pending} onClick={() => run(() => archiveCategory(c.id, !c.archived_at))}>{c.archived_at ? "Pulihkan" : "Arsipkan"}</Button>
            {!c.is_system && c.used === 0 && <Button variant="teks" disabled={pending} onClick={() => run(() => deleteCategory(c.id), "Kategori dihapus.")}>Hapus</Button>}
          </li>
        ))}
      </ul>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveCategory({ name, kind, icon_key: "circle-ellipsis", tone_key: "netral" }), "Kategori ditambahkan."); setName(""); }}>
        <label className="sr-only" htmlFor="cat-baru">Nama kategori baru</label>
        <input id="cat-baru" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Kategori baru" className={`${inputClass()} min-w-0 flex-1`} />
        <label className="sr-only" htmlFor="cat-jenis">Jenis</label>
        <select id="cat-jenis" value={kind} onChange={(e) => setKind(e.target.value as "expense")} className={`${inputClass()} w-auto`}>
          <option value="expense">Pengeluaran</option>
          <option value="income">Pemasukan</option>
        </select>
        <Button type="submit" disabled={pending}>Tambah</Button>
      </form>
    </div>
  );
}

export function Merchants({ merchants, cats }: { merchants: Merchant[]; cats: { id: string; name: string }[] }) {
  const { pending, run } = useRun();
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  if (!merchants.length) return <p className="text-[14px] text-teks-redup">Merchant muncul di sini setelah ada transaksi.</p>;
  return (
    <div className="flex flex-col gap-4">
      <ul>
        {merchants.map((m) => (
          <li key={m.id} className="flex flex-col gap-2 border-b border-garis py-3 last:border-0">
            <span className="font-semibold">{m.display_name}</span>
            <div className="flex flex-wrap items-center gap-3 text-[14px]">
              <label className="sr-only" htmlFor={`m-cat-${m.id}`}>Kategori bawaan {m.display_name}</label>
              <select id={`m-cat-${m.id}`} defaultValue={m.default_category_id ?? ""} disabled={pending}
                onChange={(e) => run(() => saveMerchantRule({ merchant_id: m.id, default_category_id: e.target.value || null, default_one_off: m.default_one_off, skip_review: m.skip_review }), "Aturan tersimpan.")}
                className={`${inputClass()} w-auto`}>
                <option value="">Tanpa kategori bawaan</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" defaultChecked={m.default_one_off} className="h-5 w-5 accent-aksen"
                onChange={(e) => run(() => saveMerchantRule({ merchant_id: m.id, default_category_id: m.default_category_id, default_one_off: e.target.checked, skip_review: m.skip_review }))} />Sekali-jalan</label>
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" defaultChecked={m.skip_review} className="h-5 w-5 accent-aksen"
                onChange={(e) => run(() => saveMerchantRule({ merchant_id: m.id, default_category_id: m.default_category_id, default_one_off: m.default_one_off, skip_review: e.target.checked }))} />Lewati peninjauan</label>
            </div>
            {m.skip_review && <p className="text-[12px] text-teks-pelan">Nominal besar dan hasil baca LLM tetap ditinjau. Hati-hati bila jumlahnya sering berubah.</p>}
          </li>
        ))}
      </ul>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => mergeMerchant(mergeFrom, mergeInto), "Merchant digabung."); }}>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-teks-redup">Gabungkan
          <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} className={`${inputClass()} w-auto font-normal`}>
            <option value="">Pilih merchant</option>
            {merchants.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-teks-redup">ke
          <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className={`${inputClass()} w-auto font-normal`}>
            <option value="">Pilih merchant tujuan</option>
            {merchants.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
        </label>
        <Button type="submit" variant="sekunder" disabled={pending || !mergeFrom || !mergeInto || mergeFrom === mergeInto}>Gabungkan</Button>
      </form>
    </div>
  );
}

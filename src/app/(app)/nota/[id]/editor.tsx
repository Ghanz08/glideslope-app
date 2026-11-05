"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus, TriangleAlert, X } from "lucide-react";
import { confirmReceipt, retryExtraction, saveReceiptEdits } from "@/app/actions/receipts";
import { validateReceipt } from "@/lib/core/domain";
import { Button, ButtonLink, Field, cx, inputClass } from "@/components/ui";
import { toast } from "@/components/toast";
import { digitsToAmount, formatThousands } from "@/lib/core/money";

interface Item { name: string; quantity: number; unit_price: number; line_total: number }
export interface ReceiptState {
  id: string;
  status: string;
  hasImage: boolean;
  merchant_name: string;
  occurred_at: string; // datetime-local value (WIB)
  items: Item[];
  subtotal: number;
  service_charge: number;
  tax_amount: number;
  tax_rate_pct: string;
  discount: number;
  rounding: number;
  total: number;
  payment_method: string;
}

const toUtc = (local: string) => (local ? new Date(`${local}:00+07:00`).toISOString() : null);

export function ReceiptEditor({ initial, accounts, categories, defaultTax }: {
  initial: ReceiptState;
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  defaultTax: number;
}) {
  const router = useRouter();
  const [r, setR] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const [category, setCategory] = useState("");
  const [pending, start] = useTransition();
  const confirmed = r.status === "confirmed";
  const v = useMemo(() => validateReceipt({ ...r, subtotal: r.subtotal, total: r.total }), [r]);
  const bad = (k: string) => v.problems.includes(k as never);
  const set = (patch: Partial<ReceiptState>) => {
    setR({ ...r, ...patch });
    setDirty(true);
  };
  const setItem = (i: number, patch: Partial<Item>) => {
    const items = r.items.map((it, j) => (j === i ? { ...it, ...patch } : it));
    set({ items });
  };
  const money = (k: keyof ReceiptState, label: string, allowNegative = false) => (
    <Field label={label} name={k} error={bad(k) ? "Hitungan tidak cocok" : undefined}>
      <input id={k} inputMode="numeric" disabled={confirmed} value={allowNegative && Number(r[k]) < 0 ? `-${formatThousands(-Number(r[k]))}` : formatThousands(Number(r[k]) || 0)}
        onChange={(e) => set({ [k]: (allowNegative && e.target.value.trim().startsWith("-") ? -1 : 1) * digitsToAmount(e.target.value) } as Partial<ReceiptState>)}
        className={cx(inputClass(bad(k) ? "x" : undefined), "tabular")} />
    </Field>
  );

  const save = () =>
    start(async () => {
      const res = await saveReceiptEdits(r.id, {
        merchant_name: r.merchant_name || null, occurred_at: toUtc(r.occurred_at), items: r.items, subtotal: r.subtotal, service_charge: r.service_charge,
        tax_amount: r.tax_amount, tax_rate_pct: r.tax_rate_pct ? Number(r.tax_rate_pct.replace(",", ".")) : null, discount: r.discount, rounding: r.rounding, total: r.total,
        payment_method: r.payment_method || null,
      });
      if ("error" in res) return toast({ text: Object.values(res.error.fields ?? {})[0] ?? res.error.message, tone: "galat" });
      setDirty(false);
      setR((cur) => ({ ...cur, status: res.problems.length ? "perlu_koreksi" : "extracted" }));
      toast({ text: res.problems.length ? "Tersimpan. Masih ada hitungan yang belum cocok." : "Tersimpan. Hitungan cocok." });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-5">
      {r.status === "gagal" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-strip bg-galat-latar p-4 text-[14px] text-galat">
          <TriangleAlert size={18} aria-hidden />
          <span className="flex-1">Nota belum terbaca otomatis. Coba lagi atau isi manual di bawah.</span>
          {r.hasImage && <Button variant="sekunder" disabled={pending} onClick={() => start(async () => { const x = await retryExtraction(r.id); if ("ok" in x) router.refresh(); })}>Coba lagi</Button>}
        </div>
      )}
      <fieldset disabled={pending} className="contents">
      {r.status === "perlu_koreksi" && <p role="status" className="rounded-strip bg-peringatan-latar p-3 text-[14px] text-peringatan">Ada bidang yang perlu dicek. Bidang bermasalah ditandai.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Merchant" name="merchant_name"><input id="merchant_name" disabled={confirmed} value={r.merchant_name} onChange={(e) => set({ merchant_name: e.target.value })} className={inputClass()} /></Field>
        <Field label="Waktu (WIB)" name="occurred_at"><input id="occurred_at" type="datetime-local" disabled={confirmed} value={r.occurred_at} onChange={(e) => set({ occurred_at: e.target.value })} className={inputClass()} /></Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-teks-redup">Item</legend>
        <div className="flex flex-col gap-2">
          {r.items.map((it, i) => (
            <div key={i} className={cx("grid grid-cols-[1fr_64px_100px_100px_44px] items-center gap-2", bad(`item:${i}`) && "rounded-petak ring-2 ring-galat")}>
              <input aria-label={`Nama item ${i + 1}`} disabled={confirmed} value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} className={inputClass()} />
              <input aria-label={`Jumlah item ${i + 1}`} disabled={confirmed} inputMode="decimal" value={String(it.quantity).replace(".", ",")} onChange={(e) => setItem(i, { quantity: Number(e.target.value.replace(",", ".")) || 0 })} className={`${inputClass()} tabular`} />
              <input aria-label={`Harga satuan item ${i + 1}`} disabled={confirmed} inputMode="numeric" value={formatThousands(it.unit_price)} onChange={(e) => setItem(i, { unit_price: digitsToAmount(e.target.value) })} className={`${inputClass()} tabular`} />
              <input aria-label={`Total baris item ${i + 1}`} disabled={confirmed} inputMode="numeric" value={formatThousands(it.line_total)} onChange={(e) => setItem(i, { line_total: digitsToAmount(e.target.value) })} className={`${inputClass()} tabular`} />
              {!confirmed && <button type="button" aria-label={`Hapus item ${i + 1}`} onClick={() => set({ items: r.items.filter((_, j) => j !== i) })} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-isian"><X size={16} aria-hidden /></button>}
            </div>
          ))}
          {!confirmed && <Button variant="teks" onClick={() => set({ items: [...r.items, { name: "Item", quantity: 1, unit_price: 0, line_total: 0 }] })}><Plus size={16} aria-hidden />Tambah item</Button>}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {money("subtotal", "Subtotal")}
        {money("service_charge", "Biaya layanan")}
        {money("tax_amount", "Pajak")}
        <Field label="Tarif pajak (%)" name="tax_rate_pct" hint={!r.tax_rate_pct ? `Isi dari nota (nilai awal nota manual ${defaultTax}%)` : undefined}>
          <input id="tax_rate_pct" disabled={confirmed} inputMode="decimal" value={r.tax_rate_pct} onChange={(e) => set({ tax_rate_pct: e.target.value })} className={inputClass()} />
        </Field>
        {money("discount", "Diskon")}
        {money("rounding", "Pembulatan", true)}
        {money("total", "Total")}
        <Field label="Metode bayar" name="payment_method"><input id="payment_method" disabled={confirmed} value={r.payment_method} onChange={(e) => set({ payment_method: e.target.value })} className={inputClass()} /></Field>
      </div>
      </fieldset>
      <p aria-live="polite" className={cx("text-[14px] font-semibold", v.ok ? "text-masuk" : "text-peringatan")}>{v.ok ? "Hitungan cocok." : "Hitungan belum cocok: periksa bidang yang ditandai."}</p>

      {confirmed ? (
        <div className="flex flex-wrap gap-3">
          <p className="w-full text-[14px] text-teks-redup">Nota sudah dikonfirmasi.</p>
          <ButtonLink href={`/bagi/baru?nota=${r.id}`}>Bagi tagihan</ButtonLink>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-t border-garis pt-5">
          <Button variant="sekunder" disabled={pending || !dirty} onClick={save}>Simpan perubahan</Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dibayar dari akun" name="account"><select id="account" value={account} onChange={(e) => setAccount(e.target.value)} className={inputClass()}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Kategori (bila tidak cocok dengan email)" name="category"><select id="category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass()}><option value="">Dari memori merchant</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          </div>
          <Button disabled={pending || dirty || !v.ok || r.status !== "extracted"} onClick={() => start(async () => {
            const res = await confirmReceipt(r.id, account, category || null);
            if ("error" in res) return toast({ text: res.error.message, tone: "galat" });
            toast({ text: res.matched ? "Nota dikonfirmasi. Usulan pencocokan ada di Inbox." : "Nota dikonfirmasi. Masuk Inbox sebagai nota tanpa email." });
            router.refresh();
          })}>Konfirmasi nota</Button>
          {dirty && <p className="text-[13px] text-teks-redup">Simpan perubahan dulu sebelum konfirmasi.</p>}
        </div>
      )}
    </div>
  );
}

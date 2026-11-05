"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { deleteTransaction, restoreTransaction, setOneOff, updateTransaction } from "@/app/actions/transactions";
import { Button, ButtonLink, Field, inputClass, keepValues } from "@/components/ui";
import { toast } from "@/components/toast";
import { digitsToAmount, formatThousands } from "@/lib/core/money";

interface Props {
  id: string;
  updatedAt: string;
  amount: number;
  merchant: string;
  note: string;
  categoryId: string | null;
  accountId: string;
  isOneOff: boolean;
  linked: boolean;
  editableCategory: boolean;
  categories: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
}

export function DetailActions(p: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(formatThousands(p.amount));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dlg = useRef<HTMLDialogElement>(null);

  const remove = () =>
    start(async () => {
      dlg.current?.close();
      const r = await deleteTransaction(p.id);
      if ("error" in r) return toast({ text: r.error.message, tone: "galat" });
      toast({ text: "Dihapus.", ms: 6000, action: { label: "Urungkan", run: () => void restoreTransaction(p.id).then(() => router.push(`/transaksi/${p.id}`)) } });
      router.push("/transaksi");
      router.refresh();
    });

  if (editing) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={keepValues((f) =>
          start(async () => {
            const r = await updateTransaction({
              id: p.id,
              expected_updated_at: p.updatedAt,
              amount: digitsToAmount(amount),
              merchant_raw: String(f.get("merchant") ?? "") || null,
              note: String(f.get("note") ?? "") || null,
              account_id: String(f.get("account")),
              ...(p.editableCategory ? { category_id: String(f.get("category")) || null } : {}),
              remember: f.get("remember") === "on",
            });
            if ("error" in r) {
              setErrors(r.error.fields ?? { _: r.error.message });
              return;
            }
            toast({ text: "Perubahan tersimpan." });
            setEditing(false);
            router.refresh();
          })
        )}
      >
        <Field label="Jumlah (Rp)" name="amount" error={errors.amount}>
          <input id="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(formatThousands(digitsToAmount(e.target.value)))} className={`${inputClass(errors.amount)} tabular`} />
        </Field>
        <Field label="Merchant" name="merchant"><input id="merchant" name="merchant" defaultValue={p.merchant} maxLength={200} className={inputClass()} /></Field>
        {p.editableCategory && (
          <Field label="Kategori" name="category">
            <select id="category" name="category" defaultValue={p.categoryId ?? ""} className={inputClass()}>
              {/* without this the browser preselects the first category and saving a note silently categorises the transaction */}
              {!p.categoryId && <option value="">Pilih kategori</option>}
              {p.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Akun" name="account">
          <select id="account" name="account" defaultValue={p.accountId} className={inputClass()}>
            {p.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Catatan" name="note"><input id="note" name="note" defaultValue={p.note} maxLength={500} className={inputClass()} /></Field>
        {p.editableCategory && (
          <label className="flex min-h-11 items-center gap-3 text-[15px]"><input type="checkbox" name="remember" defaultChecked className="h-5 w-5 accent-aksen" />Ingat kategori untuk merchant ini</label>
        )}
        {errors._ && <p role="alert" className="text-[14px] text-galat">{errors._}</p>}
        <div className="flex gap-3">
          <Button variant="sekunder" onClick={() => setEditing(false)}>Batal</Button>
          <Button type="submit" disabled={pending} className="flex-1">Simpan perubahan</Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => setEditing(true)}>Ubah</Button>
      <ButtonLink href={`/bagi/baru?transaksi=${p.id}`} variant="sekunder">Bagi tagihan</ButtonLink>
      <Button variant="sekunder" disabled={pending} onClick={() => start(async () => { await setOneOff(p.id, !p.isOneOff); router.refresh(); })}>
        {p.isOneOff ? "Batalkan sekali-jalan" : "Tandai sekali-jalan"}
      </Button>
      <Button variant="bahaya" onClick={() => dlg.current?.showModal()}>Hapus</Button>
      <dialog ref={dlg} aria-labelledby="hapus-judul" className="m-auto w-[min(420px,calc(100%-32px))] rounded-kartu bg-permukaan p-6 shadow-e3">
        <h2 id="hapus-judul" className="text-[18px] font-bold">Hapus transaksi?</h2>
        <p className="mt-2 text-[14px] text-teks-redup">
          {p.linked ? "Kedua sisi transfer dan biaya adminnya ikut dihapus. " : ""}Saldo dihitung ulang. Kamu bisa mengurungkan dalam 6 detik.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="sekunder" autoFocus onClick={() => dlg.current?.close()}>Batal</Button>
          <Button variant="bahaya" onClick={remove} disabled={pending}>Hapus transaksi</Button>
        </div>
      </dialog>
    </div>
  );
}

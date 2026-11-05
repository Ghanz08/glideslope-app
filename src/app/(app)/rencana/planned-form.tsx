"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { deletePlannedExpense, markPlannedPaid, savePlannedExpense } from "@/app/actions/assets";
import { Button, Field, inputClass, keepValues } from "@/components/ui";
import { toast } from "@/components/toast";
import { digitsToAmount, formatThousands } from "@/lib/core/money";

export function PlannedForm({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-col gap-4" onSubmit={keepValues((f) => start(async () => {
      const r = await savePlannedExpense({
        label: String(f.get("label")),
        amount: digitsToAmount(amount),
        due_on: String(f.get("due_on")),
        repeat_months: repeat ? Number(f.get("repeat_months")) : null,
        repeat_until: repeat ? String(f.get("repeat_until") || "") || null : null,
        category_id: String(f.get("category") || "") || null,
      });
      if ("error" in r) return setErrors(r.error.fields ?? { _: r.error.message });
      setErrors({});
      setAmount("");
      toast({ text: "Rencana tersimpan." });
      router.refresh();
    }))}>
      <Field label="Label" name="label" error={errors.label}><input id="label" name="label" maxLength={40} placeholder="Biaya semester" className={inputClass(errors.label)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Jumlah (Rp)" name="amount" error={errors.amount}><input id="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value ? formatThousands(digitsToAmount(e.target.value)) : "")} className={`${inputClass(errors.amount)} tabular`} /></Field>
        <Field label="Jatuh tempo" name="due_on" error={errors.due_on}><input id="due_on" name="due_on" type="date" className={inputClass(errors.due_on)} /></Field>
      </div>
      <Field label="Kategori" name="category"><select id="category" name="category" className={inputClass()}><option value="">Tanpa kategori</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="h-5 w-5 accent-aksen" />Berulang</label>
      {repeat && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tiap (bulan)" name="repeat_months" error={errors.repeat_months}><input id="repeat_months" name="repeat_months" type="number" min={1} max={12} defaultValue={6} className={inputClass(errors.repeat_months)} /></Field>
          <Field label="Sampai (opsional)" name="repeat_until" hint="Kosong: sampai lulus + 24 bulan."><input id="repeat_until" name="repeat_until" type="date" className={inputClass()} /></Field>
        </div>
      )}
      {errors._ && <p role="alert" className="text-[14px] text-galat">{errors._}</p>}
      <Button type="submit" disabled={pending}>Simpan rencana</Button>
    </form>
  );
}

export function OccurrenceActions({ id, date, past, repeating }: { id: string; date: string; past: boolean; repeating: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const dlg = useRef<HTMLDialogElement>(null);
  const run = (fn: () => Promise<{ ok: true } | { error: { message: string } }>, msg: string) => start(async () => {
    dlg.current?.close();
    const r = await fn();
    if ("error" in r) return toast({ text: r.error.message, tone: "galat" });
    toast({ text: msg });
    router.refresh();
  });
  return (
    <div className="flex gap-1">
      {past && <Button variant="lembut" disabled={pending} onClick={() => run(() => markPlannedPaid(id, date), "Ditandai sudah dibayar.")}>Tandai sudah dibayar</Button>}
      <Button variant="teks" onClick={() => (repeating ? dlg.current?.showModal() : run(() => deletePlannedExpense(id), "Rencana dihapus."))}>Hapus</Button>
      <dialog ref={dlg} aria-labelledby={`hapus-${id}-${date}`} className="m-auto w-[min(420px,calc(100%-32px))] rounded-kartu bg-permukaan p-6 shadow-e3">
        <h2 id={`hapus-${id}-${date}`} className="text-[18px] font-bold">Hapus rencana berulang?</h2>
        <div className="mt-6 flex flex-col gap-3">
          <Button variant="sekunder" autoFocus onClick={() => dlg.current?.close()}>Batal</Button>
          <Button variant="sekunder" onClick={() => run(() => deletePlannedExpense(id, date), "Kemunculan dihapus.")}>Hapus kemunculan ini</Button>
          <Button variant="bahaya" onClick={() => run(() => deletePlannedExpense(id), "Rencana dihapus.")}>Hapus semua</Button>
        </div>
      </dialog>
    </div>
  );
}

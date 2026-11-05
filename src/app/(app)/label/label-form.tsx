"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveLabel } from "@/app/actions/labels";
import { toast } from "@/components/toast";
import { Button, Field, inputClass, keepValues } from "@/components/ui";
import { digitsToAmount, formatThousands } from "@/lib/core/money";

/** F-08.4: create or edit a label — name, "acara khusus" (auto one-off), optional target. */
export function LabelForm({ label, onSaved }: {
  label?: { id: string; name: string; auto_one_off: boolean; target_amount: number | null };
  onSaved?: "reset" | "stay";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [target, setTarget] = useState(label?.target_amount ? formatThousands(label.target_amount) : "");
  const p = label?.id ?? "baru";

  const submit = keepValues((f, el) =>
    start(async () => {
      const amount = digitsToAmount(target);
      const r = await saveLabel({
        id: label?.id, name: String(f.get("name") ?? ""), auto_one_off: f.get("auto_one_off") === "on", target_amount: amount || null,
      }).catch(() => ({ error: { message: "Tidak ada koneksi. Label belum tersimpan.", fields: undefined } }));
      if ("error" in r) {
        setErrs((r.error as { fields?: Record<string, string> }).fields ?? {});
        return toast({ text: r.error.message, tone: "galat" });
      }
      setErrs({});
      toast({ text: label ? "Label disimpan." : "Label dibuat." });
      if (onSaved === "reset") {
        el.reset();
        setTarget("");
      }
      router.refresh();
    }),
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Nama label" name={`${p}-name`} error={errs.name}>
        <input id={`${p}-name`} name="name" required maxLength={40} defaultValue={label?.name} placeholder="Misalnya: Umroh 2026" className={inputClass(errs.name)} />
      </Field>
      <Field label="Target biaya (opsional)" name={`${p}-target`} hint="Untuk melihat sudah dibayar berapa dan sisa berapa." error={errs.target_amount}>
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[15px] font-semibold text-teks-pelan">Rp</span>
          <input id={`${p}-target`} inputMode="numeric" value={target} placeholder="Kosongkan bila tanpa target"
            onChange={(e) => { const n = digitsToAmount(e.target.value); setTarget(n ? formatThousands(n) : ""); }}
            className={`${inputClass(errs.target_amount)} tabular pl-10`} />
        </div>
      </Field>
      <label className="flex items-start gap-3 rounded-strip bg-latar p-3 text-[14px]">
        <input type="checkbox" name="auto_one_off" defaultChecked={label?.auto_one_off} className="mt-0.5 h-5 w-5 shrink-0 accent-aksen" />
        <span>
          <span className="block font-semibold">Acara khusus: otomatis sekali-jalan</span>
          <span className="text-teks-redup">Transaksi berlabel ini tidak ikut rata-rata pengeluaran bulanan, jadi runway tidak terlihat lebih pendek.</span>
        </span>
      </label>
      <div><Button type="submit" disabled={pending}>{label ? "Simpan" : "Buat label"}</Button></div>
    </form>
  );
}

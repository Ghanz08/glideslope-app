"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveSettings, setPin } from "@/app/actions/settings";
import { Button, Field, inputClass, keepValues } from "@/components/ui";
import { toast } from "@/components/toast";
import { digitsToAmount, formatThousands } from "@/lib/core/money";
import type { Settings } from "@/lib/server/owner";

export function GeneralForm({ s }: { s: Settings }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [reserve, setReserve] = useState(formatThousands(s.emergency_reserve));
  const [burn, setBurn] = useState(s.burn_override != null ? formatThousands(s.burn_override) : "");
  const [threshold, setThreshold] = useState(formatThousands(s.large_amount_threshold));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={keepValues((f) =>
        start(async () => {
          const r = await saveSettings({
            graduation_date: String(f.get("graduation_date")),
            emergency_reserve: digitsToAmount(reserve),
            burn_override: burn ? digitsToAmount(burn) : null,
            large_amount_threshold: digitsToAmount(threshold),
            idle_timeout_minutes: Number(f.get("idle_timeout_minutes")),
            redaction_terms: String(f.get("redaction_terms") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
            payment_instructions: String(f.get("payment_instructions") ?? "") || null,
            llm_enabled: f.get("llm_enabled") === "on",
            auto_link_transfers: f.get("auto_link_transfers") === "on",
          });
          if ("error" in r) {
            setErrors(r.error.fields ?? {});
            return toast({ text: r.error.fields ? "Periksa isian yang ditandai." : "Pengaturan belum tersimpan. Coba lagi.", tone: "galat" });
          }
          setErrors({});
          toast({ text: "Pengaturan tersimpan." });
          router.refresh();
        })
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tanggal perkiraan lulus" name="graduation_date" error={errors.graduation_date}>
          <input id="graduation_date" name="graduation_date" type="date" defaultValue={s.graduation_date ?? ""} className={inputClass(errors.graduation_date)} />
        </Field>
        <Field label="Batas idle kunci aplikasi" name="idle_timeout_minutes" error={errors.idle_timeout_minutes}>
          <select id="idle_timeout_minutes" name="idle_timeout_minutes" defaultValue={s.idle_timeout_minutes} className={inputClass()}>
            {[1, 5, 15, 30].map((m) => <option key={m} value={m}>{m} menit</option>)}
          </select>
        </Field>
        <Field label="Cadangan darurat (Rp)" name="emergency_reserve" error={errors.emergency_reserve}>
          <input id="emergency_reserve" inputMode="numeric" value={reserve} onChange={(e) => setReserve(formatThousands(digitsToAmount(e.target.value)))} className={`${inputClass(errors.emergency_reserve)} tabular`} />
        </Field>
        <Field label="Estimasi pengeluaran bulanan (Rp, opsional)" name="burn_override" error={errors.burn_override}>
          <input id="burn_override" inputMode="numeric" value={burn} onChange={(e) => setBurn(e.target.value ? formatThousands(digitsToAmount(e.target.value)) : "")} className={`${inputClass(errors.burn_override)} tabular`} />
        </Field>
        <Field label="Ambang nominal besar (Rp)" name="large_amount_threshold" error={errors.large_amount_threshold} hint="Transaksi otomatis senilai ini atau lebih selalu ditinjau.">
          <input id="large_amount_threshold" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(formatThousands(digitsToAmount(e.target.value)))} className={`${inputClass(errors.large_amount_threshold)} tabular`} />
        </Field>
        <Field label="Kata yang diredaksi sebelum ke LLM" name="redaction_terms" hint="Nama atau alamat, pisahkan dengan koma.">
          <input id="redaction_terms" name="redaction_terms" defaultValue={s.redaction_terms.join(", ")} className={inputClass()} />
        </Field>
      </div>
      <Field label="Instruksi pembayaran di pesan penagihan" name="payment_instructions" error={errors.payment_instructions} hint="Opsional. Nomor rekening hanya muncul bila kamu menulisnya di sini.">
        <textarea id="payment_instructions" name="payment_instructions" maxLength={500} rows={3} defaultValue={s.payment_instructions ?? ""} className={`${inputClass(errors.payment_instructions)} py-2`} />
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-[15px]">
        <input type="checkbox" name="llm_enabled" defaultChecked={s.llm_enabled} className="h-5 w-5 accent-aksen" />
        Pakai LLM untuk email tanpa parser, saran kategori, dan merapikan hasil OCR nota (foto nota tidak pernah dikirim)
      </label>
      <label className="flex min-h-11 items-center gap-3 text-[15px]">
        <input type="checkbox" name="auto_link_transfers" defaultChecked={s.auto_link_transfers} className="h-5 w-5 accent-aksen" />
        Tautkan transfer antar akun otomatis (skor ≥ 0,9)
      </label>
      <Button type="submit" disabled={pending}>{pending ? "Menyimpan…" : "Simpan pengaturan"}</Button>
    </form>
  );
}

export function PinForm({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pin, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (v: string | null) =>
    start(async () => {
      const r = await setPin(v);
      if ("error" in r) return setError(r.error.message);
      setError(null);
      setValue("");
      toast({ text: v ? "PIN tersimpan." : "Kunci aplikasi dimatikan." });
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] text-teks-redup">{enabled ? "Kunci aplikasi aktif." : "Kunci aplikasi mati."} PIN disimpan sebagai hash, bukan angka aslinya.</p>
      <Field label={enabled ? "PIN baru (6 angka)" : "Atur PIN (6 angka)"} name="pin" error={error ?? undefined}>
        <input id="pin" inputMode="numeric" autoComplete="new-password" type="password" maxLength={6} value={pin}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 6))} className={`${inputClass(error ?? undefined)} tabular tracking-[0.3em]`} />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Button disabled={pending} onClick={() => (/^\d{6}$/.test(pin) ? run(pin) : setError("PIN harus 6 angka."))}>Simpan PIN</Button>
        {enabled && <Button variant="sekunder" disabled={pending} onClick={() => run(null)}>Matikan kunci</Button>}
      </div>
    </div>
  );
}

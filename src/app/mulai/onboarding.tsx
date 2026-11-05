"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveOnboardingStep } from "@/app/actions/settings";
import { AccountForm } from "@/components/account-form";
import { Button, ButtonLink, Field, inputClass, cx, keepValues } from "@/components/ui";
import { formatRupiah, digitsToAmount, formatThousands } from "@/lib/core/money";

const STEPS = ["Tanggal lulus", "Cadangan & pengeluaran", "Akun pertama", "Hubungkan Gmail"];

export function Onboarding(props: {
  step: number;
  today: string;
  graduation: string | null;
  reserve: number;
  burn: number | null;
  accounts: { name: string; balance: number }[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(Math.min(props.step, 4));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [reserve, setReserve] = useState(props.reserve ? formatThousands(props.reserve) : "");
  const [burn, setBurn] = useState(props.burn ? formatThousands(props.burn) : "");

  const advance = (input: Parameters<typeof saveOnboardingStep>[1]) =>
    start(async () => {
      setMsg(null);
      const r = await saveOnboardingStep(step, input);
      if ("error" in r) {
        setErrors(r.error.fields ?? {});
        if (!r.error.fields) setMsg(r.error.message);
        return;
      }
      setErrors({});
      if (step >= 4) return router.replace("/");
      setStep(step + 1);
      router.refresh();
    });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ol aria-label="Langkah" className="grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i + 1 === step ? "step" : undefined} className="flex flex-col gap-1.5">
            <span className={cx("h-1.5 rounded-full", i + 1 <= step ? "bg-aksen" : "bg-garis")} />
            <span className={cx("text-[12px]", i + 1 === step ? "font-semibold text-teks" : "text-teks-pelan")}>{s}</span>
          </li>
        ))}
      </ol>
      {msg && <p role="alert" className="text-[14px] text-galat">{msg}</p>}

      {step === 1 && (
        <form onSubmit={keepValues((f) => advance({ graduation_date: String(f.get("graduation_date")) }))} className="flex flex-col gap-4">
          <h2 className="text-[18px] font-bold">Kapan perkiraan kamu lulus?</h2>
          <Field label="Tanggal perkiraan lulus" name="graduation_date" error={errors.graduation_date}>
            <input id="graduation_date" name="graduation_date" type="date" defaultValue={props.graduation ?? ""} required
              aria-describedby={errors.graduation_date ? "graduation_date-galat" : undefined} className={inputClass(errors.graduation_date)} />
          </Field>
          <Button type="submit" disabled={pending}>Lanjut</Button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={keepValues(() => advance({ emergency_reserve: digitsToAmount(reserve), burn_override: burn ? digitsToAmount(burn) : null }))} className="flex flex-col gap-4">
          <h2 className="text-[18px] font-bold">Cadangan darurat dan pengeluaran bulanan</h2>
          <Field label="Cadangan darurat (tidak dihitung aman dipakai)" name="emergency_reserve" error={errors.emergency_reserve}>
            <input id="emergency_reserve" inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value ? formatThousands(digitsToAmount(e.target.value)) : "")}
              className={`${inputClass(errors.emergency_reserve)} tabular`} placeholder="0" />
          </Field>
          <Field label="Estimasi pengeluaran per bulan (opsional)" name="burn_override" error={errors.burn_override}
            hint="Dipakai sampai ada 30 hari data transaksi.">
            <input id="burn_override" inputMode="numeric" value={burn} onChange={(e) => setBurn(e.target.value ? formatThousands(digitsToAmount(e.target.value)) : "")}
              className={`${inputClass(errors.burn_override)} tabular`} />
          </Field>
          <div className="flex gap-3">
            <Button variant="sekunder" onClick={() => setStep(1)}>Kembali</Button>
            <Button type="submit" disabled={pending} className="flex-1">Lanjut</Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-[18px] font-bold">Tambahkan akun pertama</h2>
          {props.accounts.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-strip bg-isian p-3 text-[14px]">
              {props.accounts.map((a) => (
                <li key={a.name} className="flex justify-between"><span>{a.name}</span><span className="tabular">{formatRupiah(a.balance)}</span></li>
              ))}
            </ul>
          )}
          <AccountForm today={props.today} onSaved={() => router.refresh()} submitLabel="Tambah akun" />
          {errors.name && <p role="alert" className="text-[13px] text-galat">{errors.name}</p>}
          <Button variant={props.accounts.length ? "utama" : "sekunder"} disabled={pending || !props.accounts.length} onClick={() => advance({})}>
            Lanjut
          </Button>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-[18px] font-bold">Hubungkan Gmail</h2>
          <p className="text-[14px] text-teks-redup">
            Transaksi dari email bank dan merchant akan masuk sendiri. Akses hanya-baca dan hanya untuk pengirim yang kamu izinkan.
          </p>
          <ButtonLink href="/api/gmail/connect" prefetch={false}>Hubungkan Gmail</ButtonLink>
          <Button variant="teks" onClick={() => advance({})} disabled={pending}>Lewati dulu</Button>
        </div>
      )}
    </div>
  );
}

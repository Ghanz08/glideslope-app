"use client";
import { useState, useTransition } from "react";
import { saveAccount, type AccountInput } from "@/app/actions/accounts";
import { Button, Field, inputClass, keepValues } from "./ui";
import { formatThousands } from "@/lib/core/money";

export function AccountForm({
  initial, today, onSaved, submitLabel = "Simpan akun",
}: { initial?: Partial<AccountInput> & { id?: string }; today: string; onSaved?: (id: string) => void; submitLabel?: string }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [balance, setBalance] = useState(initial?.opening_balance ? formatThousands(Number(String(initial.opening_balance).replace(/\./g, ""))) : "");

  function submit(form: FormData) {
    start(async () => {
      setMsg(null);
      const hints = String(form.get("match_hints") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const r = await saveAccount({
        id: initial?.id,
        name: String(form.get("name") ?? ""),
        kind: String(form.get("kind") ?? "") as AccountInput["kind"],
        last4: String(form.get("last4") ?? "") || null,
        number: String(form.get("number") ?? "").trim() || null,
        match_hints: hints,
        opening_balance: String(form.get("opening_balance") ?? ""),
        opening_date: String(form.get("opening_date") ?? ""),
      });
      if ("error" in r) {
        setErrors(r.error.fields ?? {});
        setMsg(r.error.fields ? null : r.error.message);
        return;
      }
      setErrors({});
      onSaved?.(r.id);
    });
  }

  const err = (k: string) => errors[k];
  return (
    <form onSubmit={keepValues(submit)} className="flex flex-col gap-4" noValidate>
      <Field label="Nama akun" name="name" error={err("name")}>
        <input id="name" name="name" maxLength={40} required defaultValue={initial?.name} aria-describedby={err("name") ? "name-galat" : undefined} className={inputClass(err("name"))} />
      </Field>
      <Field label="Jenis" name="kind" error={err("kind")}>
        <select id="kind" name="kind" defaultValue={initial?.kind ?? "bank"} className={inputClass(err("kind"))}>
          <option value="bank">Bank</option>
          <option value="ewallet">E-wallet</option>
          <option value="cash">Tunai</option>
        </select>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Saldo awal" name="opening_balance" error={err("opening_balance")}>
          <div className="relative">
            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-teks-pelan">Rp</span>
            <input
              id="opening_balance"
              name="opening_balance"
              inputMode="numeric"
              value={balance}
              onChange={(e) => {
                const raw = e.target.value;
                // keep "1.5"-style input visible so validation can reject it; otherwise format thousands
                setBalance(/^[\d.]*$/.test(raw) && !/\.\d{0,2}$/.test(raw) ? formatThousands(Number(raw.replace(/\./g, "") || 0)).replace(/^0$/, "") : raw);
              }}
              aria-describedby={err("opening_balance") ? "opening_balance-galat" : undefined}
              className={`${inputClass(err("opening_balance"))} tabular pl-10`}
            />
          </div>
        </Field>
        <Field label="Tanggal saldo awal" name="opening_date" error={err("opening_date")}>
          <input id="opening_date" name="opening_date" type="date" max={today} defaultValue={initial?.opening_date ?? today} className={inputClass(err("opening_date"))} />
        </Field>
      </div>
      <Field label="Nomor rekening atau HP (opsional)" name="number" error={err("number")} hint="Tersembunyi saat tombol mata aktif. 4 digit terakhirnya dipakai untuk mencocokkan email.">
        <input id="number" name="number" inputMode="numeric" autoComplete="off" maxLength={24} defaultValue={initial?.number ?? ""}
          className={`${inputClass(err("number"))} tabular rahasia-input`} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Atau 4 digit terakhir saja" name="last4" error={err("last4")}>
          <input id="last4" name="last4" inputMode="numeric" maxLength={4} defaultValue={initial?.last4 ?? ""} className={inputClass(err("last4"))} />
        </Field>
        <Field label="Kata kunci pencocokan (opsional)" name="match_hints" hint="Pisahkan dengan koma, misalnya: livin, qris">
          <input id="match_hints" name="match_hints" defaultValue={initial?.match_hints?.join(", ")} className={inputClass()} />
        </Field>
      </div>
      {msg && (
        <p role="alert" className="text-[14px] text-galat">
          {msg}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : submitLabel}
      </Button>
    </form>
  );
}

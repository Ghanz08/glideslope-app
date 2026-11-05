"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveCheckpoint } from "@/app/actions/accounts";
import { Button, ButtonLink, Field, inputClass, keepValues } from "@/components/ui";
import { digitsToAmount, formatRupiah, formatThousands } from "@/lib/core/money";

export function CheckpointForm({ accountId, today }: { accountId: string; today: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [diff, setDiff] = useState<number | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={keepValues((f) =>
        start(async () => {
          const r = await saveCheckpoint({ account_id: accountId, as_of: String(f.get("as_of")), balance: digitsToAmount(amount) });
          if ("error" in r) return setErrors(r.error.fields ?? { balance: r.error.message });
          setErrors({});
          setDiff(r.difference);
          router.refresh();
        })
      )}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tanggal saldo" name="as_of" error={errors.as_of}>
          <input id="as_of" name="as_of" type="date" defaultValue={today} className={inputClass(errors.as_of)} />
        </Field>
        <Field label="Saldo menurut bank" name="balance" error={errors.balance}>
          <input id="balance" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value ? formatThousands(digitsToAmount(e.target.value)) : "")} className={`${inputClass(errors.balance)} tabular`} />
        </Field>
      </div>
      <Button type="submit" disabled={pending || !amount}>Simpan titik cek</Button>
      {diff !== null && (
        <div role="status" className="flex flex-col gap-3 rounded-strip bg-isian p-4 text-[14px]">
          {diff === 0 ? <p>Saldo cocok.</p> : <p>Selisih {formatRupiah(Math.abs(diff))}. Mungkin ada transaksi yang terlewat.</p>}
          {diff !== 0 && <ButtonLink href={`/tambah/pengeluaran?akun=${accountId}`} variant="lembut">Tambah transaksi yang terlewat</ButtonLink>}
        </div>
      )}
    </form>
  );
}

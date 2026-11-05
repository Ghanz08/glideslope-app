"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { redeemAsset, saveAsset, saveAssetPrice } from "@/app/actions/assets";
import { Button, Field, inputClass, keepValues } from "@/components/ui";
import { toast } from "@/components/toast";
import { digitsToAmount, formatRupiah, formatThousands } from "@/lib/core/money";

type Acc = { id: string; name: string };
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/** Per type: how the quantity and price are named, with a short hint where people commonly slip (lots vs shares). */
const UNIT: Record<string, { qty: string; price: string; hint?: string }> = {
  money_market_fund: { qty: "Jumlah unit", price: "NAV per unit (Rp)" },
  fixed_income_fund: { qty: "Jumlah unit", price: "NAV per unit (Rp)" },
  equity_fund: { qty: "Jumlah unit", price: "NAV per unit (Rp)" },
  stock: { qty: "Jumlah lembar", price: "Harga per lembar (Rp)", hint: "1 lot = 100 lembar." },
  gold: { qty: "Jumlah gram", price: "Harga per gram (Rp)" },
  crypto: { qty: "Jumlah koin", price: "Harga per koin (Rp)" },
  other: { qty: "Jumlah unit", price: "Harga per unit (Rp)" },
};

export function NewAssetForm({ accounts }: { accounts: Acc[]; today?: string }) {
  const router = useRouter();
  const [type, setType] = useState("deposit");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const bond = type === "bond";
  const deposit = type === "deposit" || bond;
  const unit = UNIT[type] ?? UNIT.other;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={keepValues((f) =>
        start(async () => {
          const r = await saveAsset({
            name: String(f.get("name")),
            type: type as "deposit",
            quantity: deposit ? 1 : num(String(f.get("quantity") || "0")),
            unit_price: num(String(f.get("unit_price") || "0")) || undefined,
            cost_basis: f.get("cost_basis") ? digitsToAmount(String(f.get("cost_basis"))) : null,
            maturity_date: String(f.get("maturity_date") || "") || null,
            interest_rate_pa: f.get("interest") ? num(String(f.get("interest"))) : null,
            coupon_day: bond && f.get("coupon_day") ? Number(f.get("coupon_day")) : null,
            destination_account_id: String(f.get("destination") || "") || null,
            funded_from_account_id: String(f.get("funded_from") || "") || null,
          });
          if ("error" in r) return setErrors(r.error.fields ?? { _: r.error.message });
          toast({ text: "Aset tersimpan." });
          router.push(`/aset/${r.id}`);
        })
      )}
    >
      <Field label="Jenis" name="type">
        <select id="type" value={type} onChange={(e) => setType(e.target.value)} className={inputClass()}>
          <optgroup label="Simpanan & pendapatan tetap">
            <option value="deposit">Deposito</option>
            <option value="bond">Obligasi & SBN (ORI, SR, SBR, ST, FR)</option>
          </optgroup>
          <optgroup label="Reksa dana">
            <option value="money_market_fund">Reksa dana pasar uang</option>
            <option value="fixed_income_fund">Reksa dana pendapatan tetap</option>
            <option value="equity_fund">Reksa dana saham & campuran</option>
          </optgroup>
          <optgroup label="Harga pasar">
            <option value="stock">Saham</option>
            <option value="gold">Emas</option>
            <option value="crypto">Kripto</option>
          </optgroup>
          <option value="other">Lainnya</option>
        </select>
      </Field>
      <Field label="Nama" name="name" error={errors.name}>
        <input id="name" name="name" maxLength={60} placeholder={bond ? "Misalnya: ORI025-T3" : type === "stock" ? "Misalnya: BBCA" : undefined} className={inputClass(errors.name)} />
      </Field>
      {!deposit && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={unit.qty} name="quantity" hint={unit.hint} error={errors.quantity}><input id="quantity" name="quantity" inputMode="decimal" className={inputClass(errors.quantity)} /></Field>
          <Field label={unit.price} name="unit_price" error={errors.unit_price}><input id="unit_price" name="unit_price" inputMode="decimal" className={inputClass(errors.unit_price)} /></Field>
        </div>
      )}
      {deposit && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={bond ? "Nominal pokok (Rp)" : "Pokok (Rp)"} name="unit_price" error={errors.unit_price}><input id="unit_price" name="unit_price" inputMode="numeric" className={inputClass(errors.unit_price)} /></Field>
          <Field label="Jatuh tempo" name="maturity_date" error={errors.maturity_date}><input id="maturity_date" name="maturity_date" type="date" className={inputClass(errors.maturity_date)} /></Field>
          <Field label={bond ? "Kupon per tahun (%)" : "Bunga per tahun (%, opsional)"} name="interest"><input id="interest" name="interest" inputMode="decimal" placeholder={bond ? "6,9" : undefined} className={inputClass()} /></Field>
          {bond && (
            <Field label="Kupon dibayar tiap tanggal" name="coupon_day" hint="SBN ritel membayar kupon tiap bulan." error={errors.coupon_day}>
              <input id="coupon_day" name="coupon_day" inputMode="numeric" maxLength={2} placeholder="15" className={inputClass(errors.coupon_day)} />
            </Field>
          )}
          <Field label={bond ? "Kupon & pelunasan masuk ke akun" : "Cair ke akun"} name="destination">
            <select id="destination" name="destination" className={inputClass()}><option value="">Pilih nanti</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </Field>
        </div>
      )}
      <Field label="Modal awal (Rp, opsional)" name="cost_basis"><input id="cost_basis" name="cost_basis" inputMode="numeric" className={inputClass()} /></Field>
      <Field label="Dibeli dari akun (opsional)" name="funded_from" hint="Bila diisi, saldo akun berkurang sebagai pembelian aset, bukan pengeluaran.">
        <select id="funded_from" name="funded_from" className={inputClass()}><option value="">Sudah dimiliki sebelumnya</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      </Field>
      {errors._ && <p role="alert" className="text-[14px] text-galat">{errors._}</p>}
      <Button type="submit" disabled={pending}>Simpan aset</Button>
    </form>
  );
}

export function PriceForm({ assetId, today, label }: { assetId: string; today: string; label: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-col gap-3" onSubmit={keepValues((f) => start(async () => {
      const r = await saveAssetPrice({ asset_id: assetId, as_of: String(f.get("as_of")), unit_price: num(String(f.get("unit_price") || "0")) });
      if ("error" in r) return setErrors(r.error.fields ?? { unit_price: r.error.message });
      setErrors({});
      toast({ text: "Harga tersimpan." });
      router.refresh();
    }))}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tanggal" name="as_of" error={errors.as_of}><input id="as_of" name="as_of" type="date" defaultValue={today} max={today} className={inputClass(errors.as_of)} /></Field>
        <Field label={label} name="unit_price" error={errors.unit_price}><input id="unit_price" name="unit_price" inputMode="decimal" className={inputClass(errors.unit_price)} /></Field>
      </div>
      <Button type="submit" variant="lembut" disabled={pending}>Simpan harga</Button>
    </form>
  );
}

export function RedeemForm({ assetId, value, accounts, defaultAccount, today }: { assetId: string; value: number; accounts: Acc[]; defaultAccount: string | null; today: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(formatThousands(value));
  const [fee, setFee] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-col gap-3" onSubmit={keepValues((f) => start(async () => {
      const r = await redeemAsset({ asset_id: assetId, amount: digitsToAmount(amount), destination_account_id: String(f.get("account")), fee: digitsToAmount(fee), occurred_on: String(f.get("on")) });
      if ("error" in r) return setErrors(r.error.fields ?? { _: r.error.message });
      toast({ text: "Pencairan tersimpan." });
      router.refresh();
    }))}>
      <Field label={`Jumlah dicairkan (maks ${formatRupiah(value)})`} name="amount" error={errors.amount}>
        <input id="amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(formatThousands(digitsToAmount(e.target.value)))} className={`${inputClass(errors.amount)} tabular`} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ke akun" name="account"><select id="account" name="account" defaultValue={defaultAccount ?? accounts[0]?.id} className={inputClass()}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Tanggal" name="on" error={errors.occurred_on}><input id="on" name="on" type="date" defaultValue={today} max={today} className={inputClass(errors.occurred_on)} /></Field>
      </div>
      <Field label="Biaya (Rp)" name="fee" error={errors.fee}><input id="fee" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value ? formatThousands(digitsToAmount(e.target.value)) : "")} placeholder="0" className={`${inputClass(errors.fee)} tabular`} /></Field>
      <p className="text-[13px] text-teks-redup">Pencairan tercatat sebagai transfer ke rekening, bukan pemasukan, dan nilai asetnya ikut berkurang.</p>
      {errors._ && <p role="alert" className="text-[14px] text-galat">{errors._}</p>}
      <Button type="submit" disabled={pending}>Cairkan</Button>
    </form>
  );
}

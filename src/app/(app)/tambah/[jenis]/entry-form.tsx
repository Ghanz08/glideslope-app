"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Check, Delete } from "lucide-react";
import { createTransaction, createTransfer, quickParse, suggestCategory } from "@/app/actions/transactions";
import { Button, CategoryTile, Field, Segmented, cx, inputClass } from "@/components/ui";
import { toast } from "@/components/toast";
import { formatRupiah, formatThousands, MAX_TX_AMOUNT, digitsToAmount } from "@/lib/core/money";
import { wibToUtcIso } from "@/lib/core/dates";

type Mode = "pengeluaran" | "pemasukan" | "transfer";
interface Opt { id: string; name: string }
interface Cat extends Opt { icon_key: string; tone_key: string }

export function EntryForm(props: {
  mode: Mode;
  accounts: Opt[];
  categories: Cat[];
  today: string;
  defaults: { account_id?: string; date?: string; merchant?: string; amount?: number; note?: string };
  llmEnabled: boolean;
}) {
  const router = useRouter();
  const { mode } = props;
  const [clientId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(props.defaults.amount ?? 0);
  const [hint, setHint] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [account, setAccount] = useState(props.defaults.account_id ?? props.accounts[0]?.id ?? "");
  const [toAccount, setToAccount] = useState(props.accounts.find((a) => a.id !== account)?.id ?? "");
  const [fee, setFee] = useState("");
  const [date, setDate] = useState(props.defaults.date ?? props.today);
  const [merchant, setMerchant] = useState(props.defaults.merchant ?? "");
  const [note, setNote] = useState(props.defaults.note ?? "");
  const [oneOff, setOneOff] = useState(false);
  const [remember, setRemember] = useState(true);
  const [quick, setQuick] = useState("");
  const [quickMsg, setQuickMsg] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const press = (d: string) => {
    const next = Number(`${amount || ""}${d}`.replace(/^0+/, "") || 0);
    if (next > MAX_TX_AMOUNT) return setHint("Maksimal Rp 999.999.999.");
    setHint(null);
    setAmount(next);
  };
  const back = () => setAmount(Math.floor(amount / 10));

  // physical keyboard as primary input on desktop (ignored while typing in a text field)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  async function applyQuick() {
    setQuickMsg(null);
    const r = await quickParse(quick, props.accounts.map((a) => a.name));
    let result = { amount: r.amount, merchant: r.merchant, account: r.account, candidates: r.candidates, via: "lokal" };
    if (!r.amount && !r.candidates.length && props.llmEnabled) {
      const res = await fetch("/api/quick-add/parse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: quick }) }).catch(() => null);
      const body = res?.ok ? await res.json() : null;
      if (body?.amount) result = { ...result, ...body, candidates: [] };
    }
    if (!result.amount && !result.candidates.length) return setQuickMsg("Tidak ada jumlah terbaca.");
    if (result.candidates.length) setCandidates(result.candidates);
    if (result.amount) setAmount(Math.min(result.amount, MAX_TX_AMOUNT));
    if (result.merchant) {
      setMerchant(result.merchant);
      void onMerchantBlur(result.merchant);
    }
    const acc = props.accounts.find((a) => a.name.toLowerCase() === (result.account ?? "").toLowerCase());
    if (acc) setAccount(acc.id);
    else if (result.account || quick) setQuickMsg(acc ? null : "Akun tidak dikenali, memakai akun terakhir.");
  }

  async function onMerchantBlur(name = merchant) {
    if (!name.trim() || category) return;
    const s = await suggestCategory(name);
    if (s.category_id && props.categories.some((c) => c.id === s.category_id)) setCategory(s.category_id);
    if (s.one_off) setOneOff(true);
  }

  const occurredAt = () => {
    const nowWib = new Date(Date.now() + 7 * 3600_000).toISOString().slice(11, 19);
    return wibToUtcIso(date, date === props.today ? nowWib : "12:00:00");
  };

  const canSave = amount > 0 && (mode === "transfer" ? account && toAccount && account !== toAccount : !!category && !!account);

  function save() {
    if (!navigator.onLine) return setErrors({ _: "Tidak ada koneksi. Transaksi belum tersimpan." });
    start(async () => {
      try {
        const r =
          mode === "transfer"
            ? await createTransfer({ client_id: clientId, from_account_id: account, to_account_id: toAccount, amount, fee: digitsToAmount(fee), occurred_at: occurredAt() })
            : await createTransaction({
                client_id: clientId, kind: mode === "pemasukan" ? "income" : "expense", amount, account_id: account, category_id: category ?? "",
                merchant_raw: merchant || null, occurred_at: occurredAt(), note: note || null, is_one_off: oneOff, remember,
              });
        if ("error" in r) {
          setErrors({ ...(r.error.fields ?? {}), _: r.error.fields ? "" : r.error.message });
          return;
        }
        toast({ text: "warning" in r && r.warning ? `Tersimpan. ${r.warning}` : "Transaksi tersimpan." });
        if (window.history.length > 1) router.back();
        else router.push("/");
        router.refresh();
      } catch {
        setErrors({ _: "Tidak ada koneksi. Transaksi belum tersimpan." });
      }
    });
  }

  const chip = (selected: boolean) =>
    cx(
      "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[14px] font-semibold",
      selected ? "border-[1.5px] border-aksen bg-aksen-lembut text-aksen" : "border-garis-kontrol text-teks",
    );
  const label = mode === "transfer" ? "Jumlah diterima" : mode === "pemasukan" ? "Pemasukan" : "Pengeluaran";

  return (
    <div className="mx-auto flex max-w-[480px] flex-col gap-5">
      <Segmented
        label="Jenis transaksi"
        value={mode}
        hrefFor={(v) => `/tambah/${v}`}
        options={[{ value: "pengeluaran", label: "Pengeluaran" }, { value: "pemasukan", label: "Pemasukan" }, { value: "transfer", label: "Transfer" }]}
      />

      {mode !== "transfer" && (
        <form onSubmit={(e) => { e.preventDefault(); void applyQuick(); }} className="flex gap-2">
          <label htmlFor="kalimat" className="sr-only">Catat dengan kalimat</label>
          <input id="kalimat" value={quick} maxLength={200} onChange={(e) => setQuick(e.target.value)} placeholder='Contoh: "kopi 28rb ovo"' className={inputClass()} />
          <Button type="submit" variant="sekunder" disabled={!quick.trim()}>Isi</Button>
        </form>
      )}
      {quickMsg && <p aria-live="polite" className="-mt-3 text-[13px] text-teks-redup">{quickMsg}</p>}
      {candidates.length > 1 && (
        <div className="-mt-2 flex flex-wrap gap-2" role="group" aria-label="Pilih jumlah">
          {candidates.map((c) => <button key={c} type="button" className={chip(amount === c)} onClick={() => { setAmount(c); setCandidates([]); }}>{formatRupiah(c)}</button>)}
        </div>
      )}

      <div className="text-center" aria-live="polite">
        <p className="text-[13px] text-teks-redup">{label}</p>
        <p className="tabular text-[44px] leading-[52px] font-bold tracking-[-0.03em]">
          <span className="mr-1 text-[22px] font-semibold text-teks-pelan">Rp</span>
          {formatThousands(amount)}
        </p>
        {hint && <p className="text-[13px] text-peringatan">{hint}</p>}
      </div>

      {mode !== "transfer" && (
        <>
          <Field label="Merchant atau keterangan" name="merchant">
            <input id="merchant" value={merchant} maxLength={200} onChange={(e) => setMerchant(e.target.value)} onBlur={() => void onMerchantBlur()} className={inputClass()} />
          </Field>
          <fieldset>
            <legend className="mb-2 text-[13px] font-semibold text-teks-redup">Kategori</legend>
            <div className="flex flex-wrap gap-2">
              {props.categories.map((c) => (
                <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)} className={chip(category === c.id)}>
                  {category === c.id ? <Check size={16} aria-hidden /> : <CategoryTile icon={c.icon_key} tone={c.tone_key} size={32} />}
                  {c.name}
                </button>
              ))}
            </div>
            {errors.category_id && <p className="mt-1 text-[13px] text-galat">{errors.category_id}</p>}
          </fieldset>
        </>
      )}

      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-teks-redup">{mode === "transfer" ? "Dari akun" : "Akun"}</legend>
        <div className="flex flex-wrap gap-2">
          {props.accounts.map((a) => (
            <button key={a.id} type="button" aria-pressed={account === a.id} onClick={() => setAccount(a.id)} className={chip(account === a.id)}>
              {account === a.id && <Check size={16} aria-hidden />}{a.name}
            </button>
          ))}
        </div>
      </fieldset>

      {mode === "transfer" && (
        <>
          <fieldset>
            <legend className="mb-2 text-[13px] font-semibold text-teks-redup">Ke akun</legend>
            <div className="flex flex-wrap gap-2">
              {props.accounts.map((a) => (
                <button key={a.id} type="button" aria-pressed={toAccount === a.id} onClick={() => setToAccount(a.id)} className={chip(toAccount === a.id)}>
                  {toAccount === a.id && <Check size={16} aria-hidden />}{a.name}
                </button>
              ))}
            </div>
            {account === toAccount && <p className="mt-1 text-[13px] text-galat" role="alert">Akun asal dan tujuan harus berbeda.</p>}
          </fieldset>
          <Field label="Biaya admin (Rp)" name="fee" error={errors.fee}>
            <input id="fee" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value ? formatThousands(digitsToAmount(e.target.value)) : "")} className={`${inputClass(errors.fee)} tabular`} placeholder="0" />
          </Field>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tanggal" name="tanggal" error={errors.occurred_at}>
          <input id="tanggal" type="date" value={date} max={props.today} onChange={(e) => setDate(e.target.value)} className={inputClass(errors.occurred_at)} />
        </Field>
        {mode !== "transfer" && (
          <Field label="Catatan" name="note">
            <input id="note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={inputClass()} />
          </Field>
        )}
      </div>

      {mode === "pengeluaran" && (
        <div className="flex flex-col gap-1">
          <label className="flex min-h-11 items-center gap-3 text-[15px]">
            <input type="checkbox" checked={oneOff} onChange={(e) => setOneOff(e.target.checked)} className="h-5 w-5 accent-aksen" />
            Sekali-jalan (tidak dihitung rata-rata rutin)
          </label>
          {merchant && (
            <label className="flex min-h-11 items-center gap-3 text-[15px]">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-5 w-5 accent-aksen" />
              Ingat kategori untuk merchant ini
            </label>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 lg:hidden" aria-label="Papan angka">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0"].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} className="tabular h-14 rounded-petak bg-permukaan text-[22px] font-semibold shadow-e1 active:bg-isian">{d}</button>
        ))}
        <button type="button" aria-label="Hapus angka" onClick={back} className="flex h-14 items-center justify-center rounded-petak bg-permukaan shadow-e1 active:bg-isian">
          <Delete size={22} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <label className="hidden lg:block">
        <span className="mb-1.5 block text-[13px] font-semibold text-teks-redup">Jumlah (ketik angka)</span>
        <input inputMode="numeric" value={amount ? formatThousands(amount) : ""} onChange={(e) => { const v = digitsToAmount(e.target.value); if (v <= MAX_TX_AMOUNT) { setAmount(v); setHint(null); } else setHint("Maksimal Rp 999.999.999."); }} className={`${inputClass()} tabular`} />
      </label>

      {errors._ && <p role="alert" className="text-[14px] text-galat">{errors._}</p>}
      <Button full onClick={save} disabled={!canSave || pending}>{pending ? "Menyimpan…" : "Simpan transaksi"}</Button>
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Copy, MessageCircle, Plus, X } from "lucide-react";
import { cancelSplit, saveSplit, shareSplit } from "@/app/actions/split";
import { allocateSplit, billMessage, validateParticipants, waLink } from "@/lib/core/split";
import { formatRupiah, formatThousands } from "@/lib/core/money";
import { Button, Field, cx, inputClass } from "@/components/ui";
import { toast } from "@/components/toast";

interface Item { id: string; name: string; line_total: number }
interface P { name: string; phone_digits: string | null; is_owner: boolean }

export function SplitEditor(props: {
  id: string;
  status: string;
  title: string;
  date: string;
  total: number;
  taxBase: "items_plus_service" | "items";
  numbers: { service_charge: number; tax_amount: number; discount: number; rounding: number };
  items: Item[];
  participants: (P & { share_amount: number })[];
  assignments: { item_id: string; participant: number; weight: number }[];
  paymentInstructions: string | null;
}) {
  const router = useRouter();
  const shared = props.status !== "draft";
  const [title, setTitle] = useState(props.title);
  const [taxBase, setTaxBase] = useState(props.taxBase);
  const [people, setPeople] = useState<P[]>(props.participants.length ? props.participants : [{ name: "Aku", phone_digits: null, is_owner: true }]);
  const [assign, setAssign] = useState(props.assignments);
  const [pending, start] = useTransition();

  const has = (item: string, p: number) => assign.some((a) => a.item_id === item && a.participant === p);
  const toggle = (item: string, p: number) =>
    setAssign(has(item, p) ? assign.filter((a) => !(a.item_id === item && a.participant === p)) : [...assign, { item_id: item, participant: p, weight: 1 }]);
  const evenAll = () => setAssign(props.items.flatMap((it) => people.map((_, p) => ({ item_id: it.id, participant: p, weight: 1 }))));
  const removePerson = (i: number) => {
    setPeople(people.filter((_, j) => j !== i));
    setAssign(assign.filter((a) => a.participant !== i).map((a) => (a.participant > i ? { ...a, participant: a.participant - 1 } : a)));
  };

  const errs = validateParticipants(people);
  const result = useMemo(
    () => allocateSplit({ total: props.total, ...props.numbers, tax_base: taxBase }, props.items, people.map((p, i) => ({ id: `p${i}`, name: p.name, is_owner: p.is_owner })),
      assign.map((a) => ({ item_id: a.item_id, participant_id: `p${a.participant}`, weight: a.weight }))),
    [props.total, props.numbers, props.items, taxBase, people, assign],
  );
  const shares = shared ? Object.fromEntries(props.participants.map((p, i) => [`p${i}`, Number(p.share_amount)])) : result.shares;
  const sum = Object.values(shares).reduce((a, b) => a + b, 0);
  const input = { title, tax_base: taxBase, participants: people, assignments: assign };
  const canShare = !shared && result.sumOk && !Object.keys(errs).length;

  const itemsOf = (p: number) => props.items.filter((it) => has(it.id, p)).map((it) => {
    const ws = assign.filter((a) => a.item_id === it.id);
    const w = ws.find((a) => a.participant === p)!.weight / ws.reduce((x, a) => x + a.weight, 0);
    return { name: ws.length > 1 ? `${it.name} (dibagi ${ws.length})` : it.name, amount: Math.round(it.line_total * w) };
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Judul" name="title" error={errs.title}><input id="title" disabled={shared} value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} className={inputClass()} /></Field>
        <Field label="Dasar pajak" name="tax_base">
          <select id="tax_base" disabled={shared} value={taxBase} onChange={(e) => setTaxBase(e.target.value as "items")} className={inputClass()}>
            <option value="items_plus_service">Item + biaya layanan − diskon</option>
            <option value="items">Item saja</option>
          </select>
        </Field>
      </div>

      <section>
        <h2 className="mb-3 text-[16px] font-bold">Peserta</h2>
        <div className="flex flex-col gap-2">
          {people.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_44px] gap-2">
              <input aria-label={`Nama peserta ${i + 1}`} disabled={shared || p.is_owner} value={p.name} maxLength={40} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={inputClass(errs[`name.${i}`])} />
              <input aria-label={`Nomor WhatsApp peserta ${i + 1}`} disabled={shared || p.is_owner} inputMode="numeric" placeholder={p.is_owner ? "pemilik" : "62812…"} value={p.phone_digits ?? ""} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, phone_digits: e.target.value.replace(/\D/g, "") || null } : x)))} className={inputClass(errs[`phone.${i}`])} />
              {!p.is_owner && !shared ? <button type="button" aria-label={`Hapus ${p.name}`} onClick={() => removePerson(i)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-isian"><X size={16} aria-hidden /></button> : <span />}
            </div>
          ))}
          {Object.entries(errs).filter(([k]) => k !== "title").map(([k, m]) => <p key={k} className="text-[13px] text-galat">{m}</p>)}
          {!shared && <Button variant="teks" onClick={() => setPeople([...people, { name: `Teman ${people.length}`, phone_digits: null, is_owner: false }])}><Plus size={16} aria-hidden />Tambah peserta</Button>}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-bold">Siapa makan apa</h2>
          {!shared && <Button variant="lembut" onClick={evenAll}>Bagi rata semua</Button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead><tr><th scope="col" className="py-2 text-left font-medium text-teks-pelan">Item</th>{people.map((p, i) => <th key={i} scope="col" className="px-2 py-2 font-medium text-teks-pelan">{p.name}</th>)}</tr></thead>
            <tbody>
              {props.items.map((it) => (
                <tr key={it.id} className={cx("border-t border-garis", result.unassigned.includes(it.id) && !shared && "bg-peringatan-latar")}>
                  <th scope="row" className="py-2 text-left font-normal">{it.name}<span className="tabular block text-[12px] text-teks-redup">{formatThousands(it.line_total)}</span></th>
                  {people.map((p, i) => (
                    <td key={i} className="px-2 text-center">
                      <input type="checkbox" disabled={shared} aria-label={`${it.name} untuk ${p.name}`} checked={has(it.id, i)} onChange={() => toggle(it.id, i)} className="h-5 w-5 accent-aksen" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!shared && result.unassigned.length > 0 && <p className="mt-2 text-[13px] text-peringatan">Belum ditugaskan: {props.items.filter((i) => result.unassigned.includes(i.id)).map((i) => i.name).join(", ")}</p>}
      </section>

      <section className="rounded-strip bg-isian p-4">
        <h2 className="mb-2 text-[16px] font-bold">Bagian tiap orang</h2>
        <ul className="flex flex-col gap-2">
          {people.map((p, i) => {
            const amount = shares[`p${i}`] ?? 0;
            const msg = billMessage({ name: p.name, title, date: props.date, items: itemsOf(i), share: amount, paymentInstructions: props.paymentInstructions });
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="flex-1 font-semibold">{p.name}</span>
                <span className="tabular font-semibold">{formatRupiah(amount)}</span>
                {shared && !p.is_owner && amount > 0 && (
                  <span className="flex w-full gap-2">
                    <a href={waLink(p.phone_digits, msg)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-aksen px-4 text-[14px] font-semibold text-white"><MessageCircle size={16} aria-hidden />Buka WhatsApp</a>
                    <Button variant="sekunder" onClick={() => navigator.clipboard.writeText(msg).then(() => toast({ text: "Pesan disalin." }))}><Copy size={16} aria-hidden />Salin pesan</Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <p className={cx("mt-3 border-t border-garis pt-3 text-[14px] font-semibold", sum === props.total ? "text-masuk" : "text-peringatan")} aria-live="polite">
          Jumlah semua bagian = {formatRupiah(sum)} {sum === props.total ? "(sama dengan total nota)" : `(total nota ${formatRupiah(props.total)})`}
        </p>
      </section>

      {!shared ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="sekunder" disabled={pending} onClick={() => start(async () => { const r = await saveSplit(props.id, input); toast("error" in r ? { text: r.error.message, tone: "galat" } : { text: "Tersimpan." }); })}>Simpan draf</Button>
          <Button disabled={pending || !canShare} onClick={() => start(async () => {
            const r = await shareSplit(props.id, input);
            if ("error" in r) return toast({ text: r.error.message, tone: "galat" });
            toast({ text: "Dibagikan. Piutang dibuat." });
            router.refresh();
          })}>Bagikan</Button>
          <Button variant="teks" disabled={pending} onClick={() => start(async () => { await cancelSplit(props.id); router.push("/"); })}>Batalkan</Button>
        </div>
      ) : props.status === "shared" && (
        <Button variant="teks" disabled={pending} onClick={() => start(async () => { const r = await cancelSplit(props.id); if ("error" in r) toast({ text: r.error.message, tone: "galat" }); else router.refresh(); })}>Batalkan tagihan</Button>
      )}
    </div>
  );
}

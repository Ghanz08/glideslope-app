// Table 5.4-D split allocation and F-10.2 WhatsApp message. Pure.
import { formatRupiah } from "./money";
import { largestRemainder } from "./domain";

export interface SplitItem {
  id: string;
  name: string;
  line_total: number;
}
export interface SplitParticipant {
  id: string;
  name: string;
  is_owner: boolean;
}
export interface SplitAssignment {
  item_id: string;
  participant_id: string;
  weight: number;
}
export interface SplitBillNumbers {
  total: number;
  service_charge: number;
  tax_amount: number;
  discount: number;
  rounding: number;
  tax_base: "items_plus_service" | "items";
}

export interface SplitResult {
  shares: Record<string, number>;
  unassigned: string[]; // item ids without any participant
  sumOk: boolean;
}

export function allocateSplit(
  bill: SplitBillNumbers,
  items: SplitItem[],
  participants: SplitParticipant[],
  assignments: SplitAssignment[],
): SplitResult {
  const sub: Record<string, number> = Object.fromEntries(participants.map((p) => [p.id, 0]));
  const unassigned: string[] = [];
  for (const it of items) {
    const as = assignments.filter((a) => a.item_id === it.id && a.weight > 0 && a.participant_id in sub);
    const w = as.reduce((s, a) => s + a.weight, 0);
    if (!w) {
      unassigned.push(it.id);
      continue;
    }
    for (const a of as) sub[a.participant_id] += (it.line_total * a.weight) / w;
  }
  const ids = participants.map((p) => p.id);
  const subTotal = ids.reduce((s, id) => s + sub[id], 0);
  const prop = (amount: number, base: Record<string, number>, baseTotal: number) =>
    Object.fromEntries(ids.map((id) => [id, baseTotal ? (amount * base[id]) / baseTotal : 0]));

  const disc = prop(bill.discount, sub, subTotal);
  const serv = prop(bill.service_charge, sub, subTotal);
  const taxBase = Object.fromEntries(
    ids.map((id) => [id, bill.tax_base === "items_plus_service" ? sub[id] + serv[id] - disc[id] : sub[id]]),
  );
  const tax = prop(bill.tax_amount, taxBase, ids.reduce((s, id) => s + taxBase[id], 0));
  const rnd = prop(bill.rounding, sub, subTotal);
  const exact = ids.map((id) => Math.max(0, sub[id] - disc[id] + serv[id] + tax[id] + rnd[id]));

  const rounded = subTotal > 0 ? largestRemainder(bill.total, exact) : ids.map(() => 0);
  const shares = Object.fromEntries(ids.map((id, i) => [id, rounded[i]]));
  const sumOk = unassigned.length === 0 && rounded.reduce((a, b) => a + b, 0) === bill.total;
  return { shares, unassigned, sumOk };
}

/** Equal split of every item among all participants ("Bagi rata semua"). */
export function splitEvenly(items: SplitItem[], participants: SplitParticipant[]): SplitAssignment[] {
  return items.flatMap((it) => participants.map((p) => ({ item_id: it.id, participant_id: p.id, weight: 1 })));
}

export const PHONE_RE = /^[0-9]{8,15}$/;

/** F-10.2: billing message; item details are cut when the message would exceed 1.500 characters. */
export function billMessage(opts: {
  name: string;
  title: string;
  date: string;
  items: { name: string; amount: number }[];
  share: number;
  paymentInstructions: string | null;
}): string {
  const head = `Halo ${opts.name}, ini bagianmu untuk ${opts.title} (${opts.date}).`;
  const tail = [`Bagianmu: ${formatRupiah(opts.share)}`, opts.paymentInstructions?.trim() || null].filter(Boolean).join("\n");
  const lines = opts.items.map((i) => `- ${i.name}: ${formatRupiah(i.amount)}`);
  let body = lines.join("\n");
  let msg = `${head}\n\nRincian:\n${body}\n\n${tail}\nTerima kasih!`;
  if (msg.length > 1500) {
    const keep: string[] = [];
    for (const l of lines) {
      if (`${head}\n\nRincian:\n${[...keep, l].join("\n")}\n…lihat rincian dari pemilik\n\n${tail}\nTerima kasih!`.length > 1500) break;
      keep.push(l);
    }
    body = `${keep.join("\n")}\n…lihat rincian dari pemilik`;
    msg = `${head}\n\nRincian:\n${body}\n\n${tail}\nTerima kasih!`;
  }
  return msg;
}

export function waLink(phone: string | null, message: string): string {
  return `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(message)}`;
}

/** Table 5.4-D impact: transaction amount minus the shares of other participants on shared/settled splits. */
export function effectiveAmount(amount: number, splits: { status: string; participants: { is_owner: boolean; share_amount: number }[] }[]): number {
  const others = splits
    .filter((b) => b.status === "shared" || b.status === "settled")
    .flatMap((b) => b.participants)
    .filter((p) => !p.is_owner)
    .reduce((a, p) => a + Number(p.share_amount), 0);
  return Math.max(0, amount - others);
}

/** F-10.1 / F-10.2 participant rules. Returns field → message, empty when valid. */
export function validateParticipants(ps: { name: string; phone_digits: string | null; is_owner: boolean }[]): Record<string, string> {
  const err: Record<string, string> = {};
  if (ps.length > 12) err.participants = "Maksimal 12 peserta.";
  if (ps.length < 1) err.participants = "Tambahkan peserta.";
  if (ps.filter((p) => p.is_owner).length !== 1) err.participants = "Harus ada tepat satu pemilik.";
  ps.forEach((p, i) => {
    if (!p.name.trim() || p.name.trim().length > 40) err[`name.${i}`] = "Nama 1–40 karakter.";
    if (p.phone_digits && !PHONE_RE.test(p.phone_digits)) err[`phone.${i}`] = "Nomor harus 8–15 angka tanpa +.";
  });
  return err;
}

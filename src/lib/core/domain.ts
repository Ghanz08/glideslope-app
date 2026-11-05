// Small pure domain rules: merchant keys, confidence (5.4-A), matching scores (5.4-F),
// largest-remainder percentages, balance labels (5.4-H), receipt validation (5.4-I), redaction (8.3).
import { daysBetween, formatMonthYear, type ISODate } from "./dates";
import { formatRupiah } from "./money";

// ---------------------------------------------------------------- F-03.5 merchant normalisation
const LEGAL_FORMS = new Set(["pt", "cv", "tbk", "ud", "pd"]);

export function normalizeMerchant(name: string): string {
  const raw = name.trim();
  const words = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !LEGAL_FORMS.has(w));
  // digits-only names keep the original text
  if (!words.some((w) => /\p{L}/u.test(w))) return raw;
  return words.join(" ");
}

/** Token similarity ratio used for receipt ↔ transaction merchant names. */
export function tokenRatio(a: string, b: string): number {
  const ta = new Set(normalizeMerchant(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeMerchant(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}

// ---------------------------------------------------------------- Table 5.4-A confidence
export type ReviewReason =
  | "llm_parsed"
  | "akun_tidak_dikenal"
  | "nominal_besar"
  | "duplikat_diduga"
  | "transfer_tidak_jelas"
  | "hanya_nota"
  | "merchant_baru"
  | "kepercayaan_rendah";

export interface ConfidenceInput {
  viaLlm: boolean;
  accountUnknown: boolean;
  amount: number;
  threshold: number;
  duplicateSuspect: boolean;
  kindUnclear: boolean;
  receiptOnly: boolean;
  merchantHasDefaultCategory: boolean;
  merchantSkipReview: boolean;
  requiredFieldsComplete: boolean;
}

export function assessConfidence(i: ConfidenceInput): {
  status: "auto_confirmed" | "needs_review";
  reason: ReviewReason | null;
  confidence: number;
} {
  const review = (reason: ReviewReason, confidence: number) => ({ status: "needs_review" as const, reason, confidence });
  if (i.viaLlm) return review("llm_parsed", 0.6);
  if (i.accountUnknown) return review("akun_tidak_dikenal", 0.5);
  if (i.amount >= i.threshold) return review("nominal_besar", 0.8);
  if (i.duplicateSuspect) return review("duplikat_diduga", 0.5);
  // rows 5–6 may be skipped by the merchant's "lewati peninjauan" switch
  if (i.kindUnclear && !i.merchantSkipReview) return review("transfer_tidak_jelas", 0.6);
  if (i.receiptOnly && !i.merchantSkipReview) return review("hanya_nota", 0.7);
  if (!i.merchantHasDefaultCategory) return review("merchant_baru", 0.7);
  if (!i.requiredFieldsComplete) return review("kepercayaan_rendah", 0.5);
  return { status: "auto_confirmed", reason: null, confidence: 0.95 };
}

export const REASON_LABEL: Record<ReviewReason, string> = {
  llm_parsed: "Dibaca otomatis, perlu dicek",
  akun_tidak_dikenal: "Akun belum ditentukan",
  nominal_besar: "Nominal besar",
  duplikat_diduga: "Diduga duplikat",
  transfer_tidak_jelas: "Belum terkait",
  hanya_nota: "Nota tanpa email",
  merchant_baru: "Merchant baru",
  kepercayaan_rendah: "Perlu dicek",
};

// ---------------------------------------------------------------- Table 5.4-F scores
export const ADMIN_FEES = [500, 999, 1000, 1500, 2500, 6500];
const MIN = 60_000;

export interface TxLite {
  id: string;
  account_id: string;
  direction: "in" | "out";
  amount: number;
  occurred_at: string;
  text?: string; // merchant_raw / note / source text, used for account hints
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Transfer score for an out/in pair; null when not a candidate. */
export function transferScore(
  out: TxLite,
  inn: TxLite,
  counterpart?: { name: string; last4: string | null },
): { score: number; fee: number } | null {
  if (out.direction !== "out" || inn.direction !== "in" || out.account_id === inn.account_id) return null;
  const fee = out.amount - inn.amount;
  if (fee !== 0 && !ADMIN_FEES.includes(fee)) return null;
  const dt = Math.abs(Date.parse(out.occurred_at) - Date.parse(inn.occurred_at));
  if (dt > 5 * 1440 * MIN) return null;
  let s = 0.4;
  s += dt <= 30 * MIN ? 0.4 : dt <= 1440 * MIN ? 0.25 : 0.1;
  if (counterpart) {
    const hay = `${out.text ?? ""} ${inn.text ?? ""}`.toLowerCase();
    if (hay.includes(counterpart.name.toLowerCase()) || (counterpart.last4 && hay.includes(counterpart.last4))) s += 0.1;
  }
  return { score: r2(Math.min(1, s)), fee };
}

/** Receipt ↔ transaction score; null when the amount is not exactly equal. */
export function receiptScore(
  receipt: { total: number; occurred_at: string | null; merchant: string | null },
  tx: { amount: number; occurred_at: string; merchant: string | null },
): number | null {
  if (receipt.total !== tx.amount) return null;
  let s = 0.6;
  if (receipt.occurred_at) {
    const dt = Math.abs(Date.parse(receipt.occurred_at) - Date.parse(tx.occurred_at));
    if (dt <= 15 * MIN) s += 0.25;
    else if (dt <= 120 * MIN) s += 0.15;
    else if (dt <= 2 * 1440 * MIN) s += 0.05;
  }
  if (receipt.merchant && tx.merchant && tokenRatio(receipt.merchant, tx.merchant) >= 0.6) s += 0.15;
  return r2(Math.min(1, s));
}

/** Repayment score; null when outside 30 days of sharing or amount not plausible. */
export function repaymentScore(
  tx: { amount: number; occurred_at: string; text: string },
  rec: { remaining: number; person_name: string; shared_at: string },
): number | null {
  const age = Date.parse(tx.occurred_at) - Date.parse(rec.shared_at);
  if (age < 0 || age > 30 * 1440 * MIN) return null;
  let s: number;
  if (tx.amount === rec.remaining) s = 0.6;
  else if (tx.amount >= 1 && tx.amount <= rec.remaining - 1) s = 0.3;
  else return null;
  if (tx.text.toLowerCase().includes(rec.person_name.toLowerCase())) s += 0.3;
  return r2(s);
}

/** Pick one-to-one pairs greedily by best score (ties: smaller time gap). */
export function pickOneToOne<T extends { a: string; b: string; score: number; gap: number }>(cands: T[]): T[] {
  const sorted = [...cands].sort((x, y) => y.score - x.score || x.gap - y.gap);
  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const out: T[] = [];
  for (const c of sorted) {
    if (usedA.has(c.a) || usedB.has(c.b)) continue;
    usedA.add(c.a);
    usedB.add(c.b);
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- largest remainder
/** Integer split of `total` proportional to `weights`; ties go to earlier entries. */
export function largestRemainder(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i]++;
    left--;
  }
  return floors;
}

/** Percentages with one decimal that always add up to exactly 100.0. */
export function percentages(values: number[]): number[] {
  return largestRemainder(1000, values).map((t) => t / 10);
}

// ---------------------------------------------------------------- Table 5.4-H balance source label
export interface BalanceLabelInput {
  today: ISODate;
  checkpoint: { as_of: ISODate; balance: number; computed: number } | null;
  hasAutoSource30d: boolean;
}

export type BalanceLabel = { kind: "selisih" | "cocok" | "email" | "manual"; text: string; diff?: number };

export function balanceLabel(i: BalanceLabelInput): BalanceLabel {
  const cp = i.checkpoint && daysBetween(i.checkpoint.as_of, i.today) <= 62 ? i.checkpoint : null;
  if (cp) {
    const diff = cp.balance - cp.computed;
    if (diff !== 0) return { kind: "selisih", text: `Selisih ${formatRupiah(Math.abs(diff))}`, diff };
    return { kind: "cocok", text: `Cocok statement ${formatMonthYear(cp.as_of).split(" ")[0]}` };
  }
  if (i.hasAutoSource30d) return { kind: "email", text: "Dari email" };
  return { kind: "manual", text: "Diisi manual" };
}

// ---------------------------------------------------------------- Table 5.4-I receipt validation
export interface ReceiptNumbers {
  items: { quantity: number; unit_price: number; line_total: number }[];
  subtotal: number | null;
  service_charge: number;
  tax_amount: number;
  discount: number;
  rounding: number;
  total: number | null;
}

export type ReceiptProblem = "subtotal" | "total" | `item:${number}` | "negatif";

export function validateReceipt(r: ReceiptNumbers): { ok: boolean; problems: ReceiptProblem[] } {
  const problems: ReceiptProblem[] = [];
  const tol = 100;
  const nums = [r.subtotal ?? 0, r.service_charge, r.tax_amount, r.discount, r.total ?? 0, ...r.items.flatMap((i) => [i.unit_price, i.line_total])];
  if (nums.some((n) => !Number.isInteger(n) || n < 0) || !Number.isInteger(r.rounding)) problems.push("negatif");
  r.items.forEach((it, i) => {
    if (Math.abs(Math.round(it.quantity * it.unit_price) - it.line_total) > tol) problems.push(`item:${i}`);
  });
  const lines = r.items.reduce((a, i) => a + i.line_total, 0);
  if (r.subtotal == null || Math.abs(lines - r.subtotal) > tol) problems.push("subtotal");
  const expected = (r.subtotal ?? 0) + r.service_charge + r.tax_amount - r.discount + r.rounding;
  if (r.total == null || r.total <= 0 || Math.abs(expected - r.total) > tol) problems.push("total");
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------- section 8.3 redaction
export function redact(text: string, terms: string[] = []): string {
  let s = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(?:\+62|\b62|\b0)8\d{1,3}[-\s]?\d{3,4}[-\s]?\d{3,5}\b/g, "[telepon]")
    .replace(/\d{8,}/g, (m) => `••••${m.slice(-4)}`);
  for (const t of terms.map((t) => t.trim()).filter(Boolean)) {
    s = s.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[nama]");
  }
  return s;
}

const ACRONYMS = new Set(["PT", "CV", "UD", "TB", "RS", "BCA", "BNI", "BRI", "BSI", "BTN", "OVO", "QRIS", "ATM", "SPBU", "PLN", "PDAM", "KFC", "BPJS", "SMA", "SMP", "SD", "TK", "ABC"]);
/** Bank emails shout names ("SITI NUR AISYAH"); show all-caps words in title case, keeping known acronyms (PT, BNI). */
export function displayName(name: string): string {
  return name.replace(/\p{L}[\p{L}'’]*/gu, (w) =>
    w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase() && !ACRONYMS.has(w) ? w[0] + w.slice(1).toLowerCase() : w,
  );
}

/** Up to two initials for a merchant monogram, skipping legal prefixes. */
export function monogram(name: string): string {
  // masked numbers ("OVO ****1234") identify an account, not the name
  const words = name.replace(/^(pt|cv|ud|tb)\.?\s+/i, "").replace(/[*•]+\s?\d+/g, "").match(/\p{L}[\p{L}\p{N}]*|\p{N}+/gu) ?? [];
  const [a = "?", b] = words;
  return (b ? a.charAt(0) + b.charAt(0) : a.slice(0, 2)).toUpperCase();
}

const MONO_TONES = ["makan", "rumah", "hiburan", "belanja", "pendidikan", "kesehatan", "transportasi", "tagihan"];
/** Stable tone for a name, so the same merchant always gets the same colour. */
export function toneFor(name: string): string {
  let h = 0;
  for (const ch of normalizeMerchant(name)) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return MONO_TONES[h % MONO_TONES.length];
}

/** AI category suggestions at or above this are preselected in the bulk-confirm list (8.3); the owner still confirms. */
export const SURE_CONFIDENCE = 0.75;

/**
 * F-03.3: the owner's e-wallet a top-up went to, matched on account name or keywords in the recipient text
 * ("GoPay Customer ****1234"). When both the recipient and the wallet carry a number, the last 4 digits must agree,
 * so a top-up to a friend's ShopeePay is not mistaken for the owner's own.
 */
export function topUpTarget(recipient: string | null, wallets: { id: string; name: string; match_hints: string[]; last4?: string | null }[]) {
  const text = (recipient ?? "").toLowerCase();
  if (!text) return undefined;
  const number = text.match(/\*+\s?(\d{4})\b/)?.[1];
  const hit = wallets.find(
    (w) =>
      (text.includes(w.name.toLowerCase()) || w.match_hints.some((h) => h && text.includes(h.toLowerCase()))) &&
      (!number || !w.last4 || w.last4 === number),
  );
  return hit ? { id: hit.id, name: hit.name } : undefined;
}

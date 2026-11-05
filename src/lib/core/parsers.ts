// Deterministic email parsers — Table 5.4-B. Built from synthetic fixtures (OQ-2 default);
// email_sources.verified_with_real_email stays false until checked against real emails.
import { parseRupiah } from "./money";

export type ParserId = "mandiri" | "grab" | "shopee" | "google_play" | "esb" | "gojek";
export const PARSER_IDS: ParserId[] = ["mandiri", "grab", "shopee", "google_play", "esb", "gojek"];

export interface EmailInput {
  from: string;
  subject: string;
  text: string; // plain text, or HTML (converted)
  date: string; // email Date header, ISO
}

export interface ParsedTx {
  amount: number;
  occurred_at: string; // ISO UTC
  direction: "in" | "out";
  kind_hint: "expense" | "income" | "transfer_unknown";
  merchant_raw: string | null;
  account_hint: string | null;
  payment_method: string | null;
  dedupe_key: string;
  details?: Record<string, string>;
}

export type ParseResult =
  | { status: "parsed"; transactions: ParsedTx[] }
  | { status: "ignored"; reason: string; transactions: [] }
  | { status: "failed"; reason: string; transactions: [] };

// ---------------------------------------------------------------- shared helpers
export function htmlToText(html: string): string {
  if (!/<[a-z][\s\S]*>/i.test(html)) return html;
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " : ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/ : \s*\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Value of a "Label : value" line. */
export function field(text: string, labels: string[]): string | null {
  for (const l of labels) {
    const m = text.match(new RegExp(`^\\s*${esc(l)}\\s*[:：]\\s*(.+?)\\s*$`, "im"));
    if (m) return m[1];
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3,
  apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12,
};

/** "14 Nov 2026" + "17:57:04" (no zone = WIB) → ISO UTC. Returns null when unreadable. */
export function parseIdDateTime(dateText: string | null, timeText: string | null): string | null {
  if (!dateText) return null;
  const m = dateText.match(/(\d{1,2})[\s/-]+([A-Za-z]+|\d{1,2})[\s/-]+(\d{4})(?:[,\s]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/);
  if (!m) return null;
  const month = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const t = (timeText ?? "").match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
  const hh = Number(t?.[1] ?? m[4] ?? 0);
  const mm = Number(t?.[2] ?? m[5] ?? 0);
  const ss = Number(t?.[3] ?? m[6] ?? 0);
  const ms = Date.UTC(Number(m[3]), month - 1, Number(m[1]), hh - 7, mm, ss); // WIB = UTC+7
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// Livin' writes failures as "Pembayaran Tidak Berhasil"; "berhasil" alone is success, so the negation must be matched
const FAIL_WORDS = /\b(gagal|tidak berhasil|dibatalkan|batal|kedaluwarsa|kadaluarsa|expired|failed|unsuccessful|cancell?ed|refund(ed)?)\b/i;

function amountOf(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(?:Rp\.?|IDR)\s?[0-9.,]+/i); // Livin writes "IDR" on marketplace payments
  return m ? parseRupiah(m[0].replace(/[.,]$/, "")) : null;
}

const ok = (transactions: ParsedTx[]): ParseResult => ({ status: "parsed", transactions });
const ignored = (reason: string): ParseResult => ({ status: "ignored", reason, transactions: [] });
const failed = (reason: string): ParseResult => ({ status: "failed", reason, transactions: [] });

// ---------------------------------------------------------------- per-service parsers
/** Value on the line after a standalone label line ("Penerima\nALFAMART …"), as Livin emails lay out parties. */
export function block(text: string, labels: string[], lines = 1): string | null {
  const rows = text.split("\n").map((l) => l.trim());
  for (const l of labels) {
    const i = rows.findIndex((r) => r.toLowerCase() === l.toLowerCase());
    if (i < 0) continue;
    const next = rows.slice(i + 1).filter(Boolean).slice(0, lines);
    if (next.length) return next.join(" ").replace(/\s+/g, " ");
  }
  return null;
}

// Livin' by Mandiri: the transaction type is in the subject ("Pembayaran Berhasil!", "Top-up Berhasil",
// "Transfer Berhasil", "Transfer dengan BI Fast Berhasil"); parties sit on the line under their label.
function mandiri(e: EmailInput, text: string): ParseResult {
  const status = field(text, ["Status", "Status Transaksi"]);
  if ((status && FAIL_WORDS.test(status)) || FAIL_WORDS.test(e.subject) || /transaksi (gagal|dibatalkan)/i.test(text)) return ignored("transaksi tidak sukses");
  const kindText = `${field(text, ["Jenis Transaksi", "Jenis"]) ?? ""} ${e.subject}`;
  const amount = amountOf(field(text, ["Nominal Transaksi", "Nominal Top-up", "Nominal Transfer", "Jumlah Transfer", "Nominal", "Jumlah"]));
  const fee = amountOf(field(text, ["Biaya Transaksi", "Biaya Transfer", "Biaya Admin"]));
  const ref = field(text, ["No. Referensi", "No. Referensi BI Fast", "Nomor Referensi", "No Referensi"]);
  const when = parseIdDateTime(field(text, ["Tanggal", "Tanggal Transaksi"]), field(text, ["Waktu", "Jam"]));
  if (!amount || !ref || !when) return failed("field wajib tidak lengkap");
  const isIn = /masuk|diterima/i.test(kindText);
  const isPayment = !isIn && /qris|\bqr\b|pembayaran|purchase|belanja/i.test(kindText);
  // top-ups name the wallet and its number on two lines ("OVO" / "****1234"); the number tells own wallet from a friend's
  const counter = isIn
    ? (field(text, ["Pengirim", "Dari"]) ?? block(text, ["Pengirim", "Dari"]))
    : (field(text, ["Penerima", "Nama Penerima", "Merchant"]) ?? block(text, ["Penyedia Jasa"], 2)?.replace(/^(.*?\*+\s?\d{2,4}).*$/, "$1") ?? block(text, ["Penerima", "Merchant"]));
  const source = field(text, ["Sumber Dana", "Rekening Sumber"]) ?? block(text, ["Sumber Dana", "Rekening Sumber"], 2);
  const key = `mandiri:${ref.replace(/\s/g, "")}`;
  const method = isPayment ? "QRIS" : /top-?up/i.test(kindText) ? "Top-up" : isIn ? "Transfer masuk" : "Transfer";
  const txs: ParsedTx[] = [
    {
      amount,
      occurred_at: when,
      direction: isIn ? "in" : "out",
      kind_hint: isPayment ? "expense" : "transfer_unknown",
      merchant_raw: counter,
      account_hint: `Mandiri ${source ?? ""}`.trim(),
      payment_method: method,
      dedupe_key: key,
      details: { jenis: method, referensi: ref },
    },
  ];
  // the fee leaves the same account, so it is its own transaction (expense, "Biaya admin")
  if (fee && !isIn) {
    txs.push({ amount: fee, occurred_at: when, direction: "out", kind_hint: "expense", merchant_raw: "Biaya admin Mandiri",
      account_hint: `Mandiri ${source ?? ""}`.trim(), payment_method: method, dedupe_key: `${key}:biaya` });
  }
  return ok(txs);
}

function grab(e: EmailInput, text: string): ParseResult {
  if (FAIL_WORDS.test(e.subject) || /pesanan (dibatalkan|gagal)/i.test(text)) return ignored("pesanan tidak sukses");
  const id = field(text, ["Pesanan ID", "Booking ID", "ID Pesanan"]);
  const amount = amountOf(field(text, ["Total", "Total Dibayar", "TOTAL"]));
  const when = parseIdDateTime(field(text, ["Tanggal", "Waktu Pesanan"]), field(text, ["Jam", "Waktu"]));
  if (!id || !amount || !when) return failed("field wajib tidak lengkap");
  const method = field(text, ["Dibayar dengan", "Metode Pembayaran", "Pembayaran"]);
  const merchant = field(text, ["Merchant", "Restoran", "Toko"]) ?? (/grabcar|grabbike|perjalanan/i.test(text) ? "Grab Transport" : "Grab");
  return ok([
    { amount, occurred_at: when, direction: "out", kind_hint: "expense", merchant_raw: merchant, account_hint: method,
      payment_method: method, dedupe_key: `grab:${id}` },
  ]);
}

function shopee(e: EmailInput, text: string): ParseResult {
  if (/dibatalkan|pembatalan/i.test(e.subject)) return ignored("pesanan dibatalkan");
  const method = field(text, ["Metode Pembayaran", "Pembayaran"]);
  const when = parseIdDateTime(field(text, ["Tanggal Pesanan", "Tanggal", "Waktu Pembayaran"]), field(text, ["Jam"]));
  const blocks = text.split(/(?=^\s*No\.? Pesanan\s*[:：])/im).filter((b) => /No\.? Pesanan\s*[:：]/i.test(b));
  if (!blocks.length || !when) return failed("nomor pesanan atau tanggal tidak ditemukan");
  const txs: ParsedTx[] = [];
  for (const b of blocks) {
    if (/^\s*Status\s*[:：].*(batal|gagal)/im.test(b)) continue;
    const no = field(b, ["No. Pesanan", "No Pesanan"]);
    const amount = amountOf(field(b, ["Total Pembayaran", "Total Pesanan", "Total"]));
    if (!no || !amount) return failed("pesanan tanpa total");
    txs.push({ amount, occurred_at: when, direction: "out", kind_hint: "expense", merchant_raw: field(b, ["Toko", "Penjual"]) ?? "Shopee",
      account_hint: method, payment_method: method, dedupe_key: `shopee:${no}` });
  }
  return txs.length ? ok(txs) : ignored("semua pesanan dibatalkan");
}

function googlePlay(e: EmailInput, text: string): ParseResult {
  if (/refund|pengembalian dana|dibatalkan/i.test(e.subject)) return ignored("bukan pembelian");
  const order = field(text, ["Nomor pesanan", "Order number", "No. pesanan"]);
  const amount = amountOf(field(text, ["Total", "Jumlah total"]));
  const when = parseIdDateTime(field(text, ["Tanggal pesanan", "Tanggal", "Order date"]), field(text, ["Waktu"])) ?? e.date;
  if (!order || !amount) return failed("nomor pesanan atau total tidak ditemukan");
  const item = field(text, ["Item", "Produk"]);
  const method = field(text, ["Metode pembayaran", "Payment method"]);
  return ok([
    { amount, occurred_at: new Date(when).toISOString(), direction: "out", kind_hint: "expense",
      merchant_raw: item ? `Google Play · ${item}` : "Google Play", account_hint: method, payment_method: method,
      dedupe_key: `google_play:${order}` },
  ]);
}

function esb(e: EmailInput, text: string): ParseResult {
  if (/void|dibatalkan/i.test(e.subject) || /^\s*Status\s*[:：].*(void|batal|gagal)/im.test(text)) return ignored("struk dibatalkan");
  const code = field(text, ["Kode Transaksi", "Transaction Code", "No. Transaksi"]);
  const amount = amountOf(field(text, ["Grand Total", "Total"]));
  const when = parseIdDateTime(field(text, ["Tanggal", "Date"]), field(text, ["Jam", "Time"]));
  if (!code || !amount || !when) return failed("field wajib tidak lengkap");
  const method = field(text, ["Pembayaran", "Payment"]);
  return ok([
    { amount, occurred_at: when, direction: "out", kind_hint: "expense", merchant_raw: field(text, ["Outlet", "Restoran"]) ?? "Restoran",
      account_hint: method, payment_method: method, dedupe_key: `esb:${code}` },
  ]);
}

function gojek(e: EmailInput, text: string): ParseResult {
  if (FAIL_WORDS.test(e.subject) || /perjalanan dibatalkan|pesanan dibatalkan/i.test(text)) return ignored("pesanan tidak sukses");
  const id = field(text, ["ID Struk", "Order ID", "ID Pesanan"]);
  const amount = amountOf(field(text, ["Total Bayar", "Total Pembayaran", "Total"]));
  const when = parseIdDateTime(field(text, ["Tanggal", "Waktu"]), field(text, ["Jam"]));
  if (!id || !amount || !when) return failed("field wajib tidak lengkap");
  const method = field(text, ["Metode Pembayaran", "Dibayar dengan"]);
  const merchant = field(text, ["Restoran", "Merchant"]) ?? field(text, ["Layanan"]) ?? "Gojek";
  return ok([
    { amount, occurred_at: when, direction: "out", kind_hint: "expense", merchant_raw: merchant, account_hint: method,
      payment_method: method, dedupe_key: `gojek:${id}` },
  ]);
}

const PARSERS: Record<ParserId, (e: EmailInput, text: string) => ParseResult> = {
  mandiri,
  grab,
  shopee,
  google_play: googlePlay,
  esb,
  gojek,
};

/** Never throws: any failure becomes `failed` with a reason (F-04.3). */
export function parseEmail(parserId: ParserId, email: EmailInput): ParseResult {
  try {
    const fn = PARSERS[parserId];
    if (!fn) return failed("parser tidak dikenal");
    const text = htmlToText(email.text ?? "");
    if (!text.trim()) return failed("email kosong");
    const r = fn(email, text);
    if (r.status === "parsed") {
      for (const t of r.transactions) {
        if (t.merchant_raw) t.merchant_raw = t.merchant_raw.slice(0, 200);
        if (!(t.amount > 0) || !t.dedupe_key) return failed("hasil tidak valid");
      }
    }
    return r;
  } catch {
    return failed("galat parser");
  }
}

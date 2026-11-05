// F-09.1: turn OCR text lines (with boxes) from the receipt OCR service into receipt numbers. Deterministic and
// unit-tested; the LLM is only an optional helper afterwards (src/lib/ingest/receipt.ts) when validation fails.
import { parseIdDateTime } from "./parsers";

export interface OcrLine {
  text: string;
  score: number;
  box: [number, number, number, number]; // x0, y0, x1, y1
}

export interface OcrReceipt {
  merchant_name: string | null;
  occurred_at: string | null;
  items: { name: string; quantity: number; unit_price: number; line_total: number }[];
  subtotal: number | null;
  service_charge: number;
  tax_amount: number;
  tax_rate_pct: number | null;
  discount: number;
  rounding: number;
  total: number | null;
  payment_method: string | null;
}

interface Row {
  y: number;
  h: number;
  label: string; // text left of the amount column
  amount: number | null; // signed value in the amount column, if any
  text: string; // whole row
}

/** "56.000", "95,000", "-9.600", "(5.000)", "Rp 12.500", "40" → integer rupiah; null when it is not an amount. */
export function receiptAmount(token: string): number | null {
  const t = token.replace(/\s/g, "").replace(/^rp\.?/i, "");
  const m = t.match(/^(\(|-)?(?:rp\.?)?(\d{1,3}(?:[.,]\d{3})+|\d{1,7})(?:[.,]00)?\)?$/i);
  if (!m) return null;
  const v = Number(m[2].replace(/[.,]/g, ""));
  return m[1] ? -v : v;
}

/** Group OCR boxes into visual rows: boxes whose vertical centres are close belong together (handles slight tilt). */
export function groupRows(lines: OcrLine[], width: number): Row[] {
  const items = lines
    .filter((l) => l.text.trim() && l.score >= 0.5)
    .map((l) => ({ ...l, yc: (l.box[1] + l.box[3]) / 2, h: Math.max(1, l.box[3] - l.box[1]) }))
    .sort((a, b) => a.yc - b.yc);
  const rows: { yc: number; h: number; parts: typeof items }[] = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.yc - it.yc) < Math.min(r.h, it.h) * 0.6);
    if (row) {
      row.parts.push(it);
      row.yc = row.parts.reduce((a, p) => a + p.yc, 0) / row.parts.length;
    } else rows.push({ yc: it.yc, h: it.h, parts: [it] });
  }
  return rows.map((r) => {
    const parts = [...r.parts].sort((a, b) => a.box[0] - b.box[0]);
    const last = parts[parts.length - 1];
    // the amount column sits on the right; a lone number on the left ("Meja 7") is not an amount
    const amount = parts.length > 1 || last.box[0] > width * 0.45 ? receiptAmount(last.text) : null;
    const labelParts = amount != null ? parts.slice(0, -1) : parts;
    return {
      y: r.yc,
      h: r.h,
      label: labelParts.map((p) => p.text.trim()).join(" ").replace(/[:：]\s*$/, "").trim(),
      amount,
      text: parts.map((p) => p.text.trim()).join(" "),
    };
  });
}

// OCR often drops spaces ("SERVICE5%", "SubTotal"), so keywords are matched on a squashed lowercase label
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, "");
const K = {
  subtotal: /^(subtotal|subttl|hargajual|jumlahharga|totalharga|totalbelanja)/,
  total: /^(grandtotal|total|totalbayar|totaltagihan|jumlahbayar|tagihan|netto|nett)/,
  tax: /^(ppn|pb1|pbjt|pajak|tax|vat)/,
  service: /^(service|servis|svc|sc\d|servicecharge|biayalayanan)/,
  discount: /^(diskon|disc|discount|potongan|hemat|promo|voucher)/,
  rounding: /^(pembulatan|rounding|round)/,
  payment: /^(tunai|cash|kembali|kembalian|change|debit|kredit|credit|qris|ovo|gopay|dana|shopeepay|linkaja|edc|card|kartu|bayar|transfer)/,
  ignore: /^(totalitem|totalqty|jumlahitem|qty|item\d|ppndibebaskan|dpp)/,
};
const isSeparator = (s: string) => /^[-=_*.\s]{5,}$/.test(s);
const QTY_LINE = /^(\d{1,3}(?:[.,]\d{1,2})?)\s*[x×*@]\s*(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d{1,7})\s*$/i;
const LEAD_QTY = /^(\d{1,2})\s+(?![x×@]\s)(\D.*)$/;
const NOT_MERCHANT = /\b(jl|jalan|telp|tel|hp|wa|npwp|no\.|tgl|tanggal|jam|kasir|meja|struk|nota|invoice)\b|^\d|https?:|www\./i;

const pct = (label: string) => {
  const m = label.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
  return m ? Number(m[1].replace(",", ".")) : null;
};

function findDateTime(rows: Row[]): string | null {
  for (const r of rows) {
    const t = r.text.replace(/(\d{1,2})\.(\d{1,2})\.(\d{4})/, "$1/$2/$3"); // "14.11.2026" → "14/11/2026"
    const date = t.match(/\d{1,2}[\s/-]+(?:[A-Za-z]{3,9}|\d{1,2})[\s/-]+\d{4}/)?.[0];
    if (!date) continue;
    const time = t.match(/\b\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\b(?!\s*%)/g)?.find((x) => !date.includes(x)) ?? null;
    const iso = parseIdDateTime(date, time);
    if (iso) return iso;
  }
  return null;
}

/** OCR lines → receipt numbers. Items are the amount rows above the first summary row; qty lines attach to the name above. */
export function parseOcrReceipt(lines: OcrLine[], width: number): OcrReceipt {
  const rows = groupRows(lines, width).filter((r) => !isSeparator(r.text));
  const out: OcrReceipt = {
    merchant_name: null, occurred_at: findDateTime(rows), items: [], subtotal: null, service_charge: 0, tax_amount: 0,
    tax_rate_pct: null, discount: 0, rounding: 0, total: null, payment_method: null,
  };
  const firstMoney = rows.findIndex((r) => r.amount != null);
  out.merchant_name = rows.slice(0, firstMoney < 0 ? 3 : Math.min(firstMoney, 3)).find((r) => /[a-z]{3}/i.test(r.text) && !NOT_MERCHANT.test(r.text))?.text ?? null;

  let summary = false;
  let pendingName: string | null = null;
  for (const r of rows) {
    const key = squash(r.label);
    if (K.ignore.test(key)) continue;
    if (K.subtotal.test(key)) {
      summary = true;
      if (r.amount != null && out.subtotal == null) out.subtotal = Math.abs(r.amount);
      continue;
    }
    if (K.total.test(key)) {
      summary = true;
      if (r.amount != null && out.total == null) out.total = Math.abs(r.amount);
      continue;
    }
    if (K.tax.test(key)) {
      summary = true;
      if (r.amount != null) {
        out.tax_amount += Math.abs(r.amount);
        out.tax_rate_pct ??= pct(r.label);
      }
      continue;
    }
    if (K.service.test(key)) {
      summary = true;
      if (r.amount != null) out.service_charge += Math.abs(r.amount);
      continue;
    }
    if (K.discount.test(key)) {
      summary = true;
      if (r.amount != null) out.discount += Math.abs(r.amount);
      continue;
    }
    if (K.rounding.test(key)) {
      summary = true;
      if (r.amount != null) out.rounding += r.amount;
      continue;
    }
    if (K.payment.test(key)) {
      summary = true;
      out.payment_method ??= r.label.replace(/[:]/g, "").trim().slice(0, 60) || null;
      continue;
    }
    if (summary) continue;

    const qty = r.text.match(QTY_LINE) ?? (r.label.match(QTY_LINE) && r.amount != null ? r.label.match(QTY_LINE) : null);
    if (qty && pendingName) {
      // "2 × 28.000   56.000" under the item name
      const quantity = Number(qty[1].replace(",", "."));
      const unit = receiptAmount(qty[2]) ?? 0;
      out.items.push({ name: pendingName, quantity, unit_price: unit, line_total: r.amount != null ? Math.abs(r.amount) : Math.round(quantity * unit) });
      pendingName = null;
      continue;
    }
    if (r.amount == null) {
      // a name line waiting for its qty line; header text before the first item is dropped when an item follows
      if (/[a-z]{2}/i.test(r.label) && out.merchant_name !== r.text && !findDateTime([r])) pendingName = r.label;
      continue;
    }
    if (r.amount <= 0 || !/[a-z]{2}/i.test(r.label)) continue;
    const lead = r.label.match(LEAD_QTY);
    const quantity = lead ? Number(lead[1]) : 1;
    const name = (lead ? lead[2] : r.label).trim();
    const total = Math.abs(r.amount);
    out.items.push({ name, quantity, unit_price: Math.round(total / quantity), line_total: total });
    pendingName = null;
  }
  if (out.subtotal == null && out.items.length) out.subtotal = out.items.reduce((a, i) => a + i.line_total, 0);
  return out;
}

/** Plain text of the receipt, row by row, for the owner's view and the optional LLM helper. */
export function ocrText(lines: OcrLine[], width: number): string {
  return groupRows(lines, width).map((r) => r.text).join("\n");
}

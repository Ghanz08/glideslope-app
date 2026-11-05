// F-09.1 / F-09.2: receipt extraction with real OCR (ocr/ service), a deterministic parser, and Table 5.4-I
// validation; an LLM may only restructure the OCR text. Results are always reviewed by the owner.
import { amountsInText, chatJson, LlmInvalid, LlmUnreachable, type LlmConfig } from "./llm";
import { redact, validateReceipt, type ReceiptProblem } from "../core/domain";
import { ocrText, parseOcrReceipt, type OcrLine } from "../core/receipt-ocr";

export interface ReceiptData {
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
  currency_ok: boolean;
}

export const RECEIPT_SCHEMA = {
  name: "receipt",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["merchant_name", "occurred_at", "items", "subtotal", "service_charge", "tax_amount", "tax_rate_pct", "discount", "rounding", "total", "payment_method", "currency"],
    properties: {
      merchant_name: { type: ["string", "null"] },
      occurred_at: { type: ["string", "null"] },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "quantity", "unit_price", "line_total"],
          properties: { name: { type: "string" }, quantity: { type: "number" }, unit_price: { type: "integer" }, line_total: { type: "integer" } },
        },
      },
      subtotal: { type: ["integer", "null"] },
      service_charge: { type: "integer" },
      tax_amount: { type: "integer" },
      tax_rate_pct: { type: ["number", "null"] },
      discount: { type: "integer" },
      rounding: { type: "integer" },
      total: { type: ["integer", "null"] },
      payment_method: { type: ["string", "null"] },
      currency: { type: "string" },
    },
  },
};

const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

export function normaliseReceipt(raw: Record<string, unknown>): ReceiptData {
  const items = Array.isArray(raw.items) ? raw.items : [];
  const at = raw.occurred_at ? Date.parse(String(raw.occurred_at)) : NaN;
  return {
    merchant_name: raw.merchant_name ? String(raw.merchant_name).slice(0, 120) : null,
    occurred_at: Number.isNaN(at) ? null : new Date(at).toISOString(),
    items: items.slice(0, 100).map((i: Record<string, unknown>) => ({
      name: String(i.name ?? "Item").slice(0, 120) || "Item",
      quantity: Math.max(0.01, Math.round(Number(i.quantity ?? 1) * 100) / 100 || 1),
      unit_price: Math.max(0, int(i.unit_price)),
      line_total: Math.max(0, int(i.line_total)),
    })),
    subtotal: raw.subtotal == null ? null : Math.max(0, int(raw.subtotal)),
    service_charge: Math.max(0, int(raw.service_charge)),
    tax_amount: Math.max(0, int(raw.tax_amount)),
    tax_rate_pct: raw.tax_rate_pct == null ? null : Number(raw.tax_rate_pct),
    discount: Math.max(0, int(raw.discount)),
    rounding: int(raw.rounding),
    total: raw.total == null ? null : Math.max(0, int(raw.total)),
    payment_method: raw.payment_method ? String(raw.payment_method).slice(0, 60) : null,
    currency_ok: !raw.currency || String(raw.currency).toUpperCase() === "IDR",
  };
}

export type ExtractOutcome =
  | { status: "extracted" | "perlu_koreksi"; data: ReceiptData; problems: ReceiptProblem[]; model_used: string; text: string }
  | { status: "gagal"; reason: string };

export interface OcrConfig {
  url: string;
  token?: string;
  fetchFn?: typeof fetch;
}

export class OcrUnreachable extends Error {}

/** Send the photo to the OCR service; 60 s timeout. */
export async function ocrImage(cfg: OcrConfig, image: Blob): Promise<{ width: number; lines: OcrLine[] }> {
  const body = new FormData();
  body.append("file", image, "nota.jpg");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);
  try {
    const res = await (cfg.fetchFn ?? fetch)(`${cfg.url.replace(/\/$/, "")}/ocr`, {
      method: "POST", body, signal: ctl.signal, headers: cfg.token ? { "x-ocr-token": cfg.token } : {},
    });
    if (!res.ok) throw new OcrUnreachable(`ocr ${res.status}`);
    return (await res.json()) as { width: number; lines: OcrLine[] };
  } catch (e) {
    throw e instanceof OcrUnreachable ? e : new OcrUnreachable("ocr tidak terjangkau");
  } finally {
    clearTimeout(timer);
  }
}

const ASSIST_PROMPT =
  "Kamu merapikan hasil OCR nota belanja Indonesia menjadi JSON sesuai skema. Teks OCR sudah dibaca mesin OCR; " +
  "tugasmu hanya menyusun ulang. Pakai HANYA angka yang tertulis di teks OCR, jangan menghitung atau menebak angka baru " +
  "(kecuali unit_price = line_total ÷ quantity). Pajak, layanan, diskon, pembulatan diambil dari baris nota. currency = IDR bila rupiah.";

/** Every number the LLM returns (except a derived unit price) must be written on the receipt. */
function numbersFromText(d: ReceiptData, text: string): boolean {
  const seen = amountsInText(text);
  const must = [d.total, d.subtotal, d.tax_amount, d.service_charge, d.discount, Math.abs(d.rounding), ...d.items.map((i) => i.line_total)]
    .filter((n): n is number => n != null && n !== 0);
  return must.every((n) => seen.has(n));
}

/**
 * F-09.1 / F-09.2: OCR (deep-learning text detection + recognition, see ocr/app.py) → deterministic receipt parser →
 * Table 5.4-I validation. Only when that fails and the LLM is on, a text-only LLM pass may restructure the OCR text;
 * its numbers must all appear in that text. The photo itself never goes to the LLM. The owner always reviews the result.
 */
export async function extractReceipt(
  ocr: OcrConfig,
  image: Blob,
  assist: { llm: LlmConfig | null; enabled: boolean; redactionTerms: string[] },
): Promise<ExtractOutcome> {
  let res: { width: number; lines: OcrLine[] };
  try {
    res = await ocrImage(ocr, image);
  } catch {
    return { status: "gagal", reason: "Layanan OCR tidak terjangkau." };
  }
  if (!res.lines.length) return { status: "gagal", reason: "Tidak ada teks yang terbaca di foto." };
  const text = ocrText(res.lines, res.width);
  const data = normaliseReceipt(parseOcrReceipt(res.lines, res.width) as unknown as Record<string, unknown>);
  const v = validateReceipt(data);
  if (v.ok) return { status: "extracted", data, problems: [], model_used: "ocr:rapidocr", text };

  const model = assist.llm?.modelText;
  if (assist.enabled && assist.llm && model) {
    try {
      const safeText = redact(text, assist.redactionTerms).slice(0, 6000);
      const raw = await chatJson(assist.llm, model, [
        { role: "system", content: ASSIST_PROMPT },
        { role: "user", content: `Teks OCR:\n${safeText}\n\nHasil pembacaan otomatis (mungkin salah):\n${JSON.stringify(data)}` },
      ], RECEIPT_SCHEMA);
      const fixed = normaliseReceipt(raw);
      // keep what the OCR saw for fields the LLM left empty
      fixed.merchant_name ??= data.merchant_name;
      fixed.occurred_at ??= data.occurred_at;
      if (numbersFromText(fixed, text) && validateReceipt(fixed).ok && fixed.currency_ok) {
        return { status: "extracted", data: fixed, problems: [], model_used: `ocr:rapidocr+llm:${model}`, text };
      }
    } catch (e) {
      if (!(e instanceof LlmUnreachable) && !(e instanceof LlmInvalid)) throw e;
    }
  }
  return { status: "perlu_koreksi", data, problems: v.problems, model_used: "ocr:rapidocr", text };
}

/** F-09.3 one-to-one: link to the best candidate unless another receipt already holds it with a higher score. */
export function chooseReceiptMatch(cands: { txId: string; score: number; gapMs: number; bestOtherScore: number | null }[]): { txId: string; score: number } | null {
  const ok = cands.filter((c) => c.score >= 0.75 && (c.bestOtherScore == null || c.score > c.bestOtherScore)).sort((a, b) => b.score - a.score || a.gapMs - b.gapMs);
  return ok[0] ? { txId: ok[0].txId, score: ok[0].score } : null;
}

// OpenAI-compatible client for the owner's router (9router). Section 8.3: read and suggest only.
import { parseRupiah } from "../core/money";

export interface LlmConfig {
  baseUrl: string;
  apiKey?: string;
  modelText?: string;
  dailyLimit: number;
  fetchFn?: typeof fetch;
}

export class LlmUnreachable extends Error {}
export class LlmInvalid extends Error {}

export function llmConfigFromEnv(env: Record<string, string | undefined>): LlmConfig | null {
  if (!env.LLM_BASE_URL) return null;
  return {
    baseUrl: env.LLM_BASE_URL.replace(/\/$/, ""),
    apiKey: env.LLM_API_KEY,
    modelText: env.LLM_MODEL_TEXT,
    dailyLimit: Number(env.LLM_DAILY_LIMIT) || 200,
  };
}

/** One chat call with a JSON schema; 30 s timeout. Throws LlmUnreachable or LlmInvalid. */
export async function chatJson(
  cfg: LlmConfig,
  model: string,
  messages: unknown[],
  schema: { name: string; schema: object },
): Promise<Record<string, unknown>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  let res: Response;
  try {
    res = await (cfg.fetchFn ?? fetch)(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        // some OpenAI-compatible routers (9router) ignore response_format, so the schema is also spelled out here
        messages: [{ role: "system", content: `Balas HANYA dengan satu objek JSON yang valid sesuai skema JSON ini, tanpa teks lain dan tanpa pagar kode:\n${JSON.stringify(schema.schema)}` }, ...messages],
        stream: false,
        temperature: 0,
        max_tokens: 1500,
        response_format: { type: "json_schema", json_schema: { name: schema.name, schema: schema.schema, strict: true } },
      }),
    });
  } catch {
    throw new LlmUnreachable("router tidak terjangkau");
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 500 || res.status === 429) throw new LlmUnreachable(`router ${res.status}`);
  const body = await res.json().catch(() => null);
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new LlmInvalid("tanpa konten");
  const parsed = extractJson(content);
  if (!parsed) throw new LlmInvalid("bukan JSON");
  return parsed;
}

/** The first JSON object in a model reply (plain, fenced, or wrapped in prose). */
export function extractJson(content: string): Record<string, unknown> | null {
  const tries = [content.trim(), content.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)];
  for (const t of tries) {
    if (!t) continue;
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch {
      // try the next shape
    }
  }
  return null;
}

// ---------------------------------------------------------------- parse_email
export const EMAIL_SCHEMA = {
  name: "email_transactions",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["transactions", "ignored", "reason"],
    properties: {
      ignored: { type: "boolean" },
      reason: { type: "string" },
      transactions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["amount", "direction", "occurred_at", "merchant_raw", "account_hint", "kind_hint"],
          properties: {
            amount: { type: "integer" },
            direction: { type: "string", enum: ["in", "out"] },
            occurred_at: { type: "string" },
            merchant_raw: { type: ["string", "null"] },
            account_hint: { type: ["string", "null"] },
            kind_hint: { type: "string", enum: ["expense", "income", "transfer_unknown"] },
          },
        },
      },
    },
  },
};

export interface LlmTx {
  amount: number;
  direction: "in" | "out";
  occurred_at: string;
  merchant_raw: string | null;
  account_hint: string | null;
  kind_hint: "expense" | "income" | "transfer_unknown";
}

/** Every amount the source text could mean, so the model cannot invent one (F-04.4). */
export function amountsInText(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/(?:rp\.?\s?)?\d[\d.,]*/gi)) {
    const v = parseRupiah(m[0].replace(/[.,]$/, ""));
    if (v) out.add(v);
  }
  return out;
}

/** Models behind some routers answer with one flat object; map its common field names onto the schema. */
function asTransactions(raw: Record<string, unknown>): unknown {
  if (Array.isArray(raw.transactions)) return raw.transactions;
  const amount = raw.nominal ?? raw.amount;
  const at = raw.occurred_at ?? raw.timestamp ?? raw.date;
  if (amount == null || at == null) return raw.transactions;
  const type = String(raw.transaction_type ?? raw.kind_hint ?? "");
  return [{
    amount,
    direction: raw.direction ?? (/masuk|incoming|credit|in$/i.test(type) ? "in" : "out"),
    occurred_at: at,
    merchant_raw: raw.merchant_raw ?? raw.merchant ?? raw.recipient ?? null,
    account_hint: raw.account_hint ?? raw.source_account ?? raw.account_number ?? null,
    kind_hint: raw.kind_hint ?? (/payment|pembayaran|purchase|qr/i.test(type) || raw.recipient || raw.merchant ? "expense" : "transfer_unknown"),
  }];
}

export function validateEmailResult(raw: Record<string, unknown>, sourceText: string, now: Date): { ignored: boolean; txs: LlmTx[] } {
  if (raw.ignored === true) return { ignored: true, txs: [] };
  const list = asTransactions(raw);
  if (!Array.isArray(list) || !list.length) throw new LlmInvalid("tanpa transaksi");
  const seen = amountsInText(sourceText);
  const txs = list.map((t: Record<string, unknown>) => {
    const amount = Number(t.amount);
    const at = Date.parse(String(t.occurred_at));
    if (!Number.isInteger(amount) || amount <= 0) throw new LlmInvalid("jumlah tidak valid");
    if (!seen.has(amount)) throw new LlmInvalid("jumlah tidak ada di teks sumber");
    if (Number.isNaN(at) || at > now.getTime() + 86400_000) throw new LlmInvalid("tanggal tidak valid");
    if (t.direction !== "in" && t.direction !== "out") throw new LlmInvalid("arah tidak valid");
    const kind = ["expense", "income", "transfer_unknown"].includes(String(t.kind_hint)) ? (t.kind_hint as LlmTx["kind_hint"]) : "transfer_unknown";
    return {
      amount,
      direction: t.direction,
      occurred_at: new Date(at).toISOString(),
      merchant_raw: t.merchant_raw ? String(t.merchant_raw).slice(0, 200) : null,
      account_hint: t.account_hint ? String(t.account_hint).slice(0, 80) : null,
      kind_hint: kind,
    } as LlmTx;
  });
  return { ignored: false, txs };
}

export const EMAIL_PROMPT =
  "Kamu membaca email notifikasi transaksi bank atau merchant Indonesia. Kembalikan JSON sesuai skema. " +
  "Jumlah dalam rupiah bilangan bulat dan harus persis seperti tertulis di email. Waktu tanpa zona dianggap WIB (UTC+7), tulis ISO 8601. " +
  "Bila email bukan transaksi sukses (gagal, dibatalkan, promosi), isi ignored=true. " +
  'Contoh keluaran yang benar: {"ignored":false,"reason":"","transactions":[{"amount":11000,"direction":"out","occurred_at":"2026-09-17T10:58:38Z",' +
  '"merchant_raw":"MINIMARKET CONTOH","account_hint":"Mandiri ****0706","kind_hint":"expense"}]}';

// ---------------------------------------------------------------- categorize (8.3): a suggestion per merchant, never a confirmation
export const CATEGORY_SCHEMA = {
  name: "merchant_category",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["category_name", "is_transfer", "confidence"],
    properties: {
      category_name: { type: ["string", "null"] },
      is_transfer: { type: "boolean" },
      confidence: { type: "number" },
    },
  },
};

export const CATEGORY_PROMPT =
  "Kamu mengategorikan merchant atau penerima dari transaksi pengeluaran bank/e-wallet di Indonesia. " +
  "Pilih tepat satu nama kategori dari daftar yang diberikan, tulis persis sama. " +
  "Bila namanya tampak seperti isi saldo e-wallet (OVO, GoPay, ShopeePay, DANA, LinkAja), transfer ke rekening sendiri, atau nama orang, isi category_name null dan is_transfer true. " +
  "Bila tidak yakin, isi category_name null. confidence antara 0 dan 1: seberapa yakin kamu. " +
  'Contoh: {"category_name":"Makan & minum","is_transfer":false,"confidence":0.9}';

export interface CategorySuggestion {
  category_id: string | null;
  category_name: string | null;
  is_transfer: boolean;
  confidence: number;
}

/** Category name must be one of the owner's categories (case-insensitive); anything else becomes "no suggestion". */
export function validateCategoryResult(raw: Record<string, unknown>, categories: { id: string; name: string }[]): CategorySuggestion {
  const name = typeof raw.category_name === "string" ? raw.category_name.trim().toLowerCase() : "";
  const cat = name ? categories.find((c) => c.name.toLowerCase() === name) : undefined;
  const conf = Number(raw.confidence);
  if (typeof raw.is_transfer !== "boolean" && raw.category_name === undefined) throw new LlmInvalid("bukan saran kategori");
  const is_transfer = raw.is_transfer === true;
  return {
    category_id: is_transfer ? null : (cat?.id ?? null),
    category_name: is_transfer ? null : (cat?.name ?? null),
    is_transfer,
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
  };
}

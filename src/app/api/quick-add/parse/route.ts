import { NextResponse } from "next/server";
import { ownerOrError } from "@/lib/server/owner";
import { errorResponse } from "@/lib/server/errors";
import { getAccounts } from "@/lib/server/queries";
import { parseQuickAdd } from "@/lib/core/insights";
import { amountsInText, chatJson, llmConfigFromEnv, LlmUnreachable } from "@/lib/ingest/llm";
import { redact } from "@/lib/core/domain";

const SCHEMA = {
  name: "quick_add",
  schema: {
    type: "object", additionalProperties: false, required: ["amount", "merchant", "account_name"],
    properties: { amount: { type: ["integer", "null"] }, merchant: { type: ["string", "null"] }, account_name: { type: ["string", "null"] } },
  },
};

// API-39: local parser first; the LLM only when it finds no amount and the switch is on. Nothing is saved here.
export async function POST(req: Request) {
  const o = await ownerOrError();
  if (!o.ok) return NextResponse.json(o.error, { status: o.status });
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim().slice(0, 200);
  if (!text) return errorResponse(422, "VALIDASI", "Teks kosong.");
  const names = (await getAccounts(o.supabase)).map((a) => a.name);
  const local = parseQuickAdd(text, names);
  if (local.amount || local.candidates.length || !o.settings.llm_enabled) {
    return NextResponse.json({ amount: local.amount, merchant: local.merchant, account_hint: local.account, via: "lokal" });
  }
  const cfg = llmConfigFromEnv(process.env);
  try {
    if (!cfg?.modelText) throw new LlmUnreachable("LLM belum dikonfigurasi");
    const r = await chatJson(cfg, cfg.modelText, [
      { role: "system", content: "Ambil jumlah rupiah (bilangan bulat), merchant, dan nama akun dari kalimat catatan belanja. Jumlah harus ada di kalimat." },
      { role: "user", content: `Akun: ${names.join(", ")}\nKalimat: ${redact(text, o.settings.redaction_terms)}` },
    ], SCHEMA);
    const amount = Number(r.amount);
    const valid = Number.isInteger(amount) && amount > 0 && (amountsInText(text).has(amount) || text.replace(/\D/g, "").includes(String(amount)));
    return NextResponse.json({ amount: valid ? amount : null, merchant: r.merchant ?? local.merchant, account_hint: names.find((n) => n === r.account_name) ?? local.account, via: "llm" });
  } catch {
    return NextResponse.json({ amount: local.amount, merchant: local.merchant, account_hint: local.account, via: "lokal" }, { status: 503 });
  }
}

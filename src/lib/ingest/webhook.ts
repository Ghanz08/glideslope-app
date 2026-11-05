// F-12.1 request checks, in order: secret (401), size (413), shape (422).
import { secretEquals } from "./db";

export const WEBHOOK_MAX_BYTES = 8 * 1024;

export type WebhookCheck =
  | { ok: true; body: { source_app: string; text: string; posted_at: string } }
  | { ok: false; status: 401 | 413 | 422; code: string; message: string };

export async function checkWebhook(secretHeader: string | null, raw: string, secret: string | undefined, receivedAt: Date): Promise<WebhookCheck> {
  if (!(await secretEquals(secretHeader, secret))) return { ok: false, status: 401, code: "RAHASIA_SALAH", message: "Rahasia webhook salah." };
  if (new TextEncoder().encode(raw).length > WEBHOOK_MAX_BYTES) return { ok: false, status: 413, code: "TERLALU_BESAR", message: "Badan lebih dari 8 KB." };
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw);
  } catch {
    return { ok: false, status: 422, code: "JSON_SALAH", message: "Badan harus JSON." };
  }
  const text = typeof j?.text === "string" ? j.text.trim() : "";
  const app = typeof j?.source_app === "string" ? j.source_app.trim() : "";
  const at = j?.posted_at ? Date.parse(String(j.posted_at)) : NaN;
  if (!text || !app) return { ok: false, status: 422, code: "VALIDASI", message: "source_app dan text wajib diisi." };
  return { ok: true, body: { source_app: app.slice(0, 80), text: text.slice(0, 6000), posted_at: new Date(Number.isNaN(at) ? receivedAt.getTime() : at).toISOString() } };
}

/** Same text within the same minute → same id (dedupe, F-12.1). */
export async function webhookExternalId(text: string, postedAt: string): Promise<string> {
  const minute = postedAt.slice(0, 16);
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${minute}|${text}`));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

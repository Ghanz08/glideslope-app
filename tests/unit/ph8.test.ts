import { beforeAll, describe, expect, it } from "vitest";
import { checkWebhook, webhookExternalId } from "../../src/lib/ingest/webhook";
import { addUser, createDb, ingestDb, type Db as Pg } from "../db/harness";
import { ingestWebhook } from "../../src/lib/ingest/pipeline";
import { parseQuickAdd } from "../../src/lib/core/insights";

const S = "x".repeat(40);
const body = JSON.stringify({ source_app: "Livin by Mandiri", text: "Pembayaran QRIS Rp 25.000 berhasil", posted_at: "2026-11-14T05:00:00Z" });

describe("F-12.1 webhook checks", () => {
  it("valid → ok", async () => expect((await checkWebhook(S, body, S, new Date())).ok).toBe(true));
  it("wrong or empty secret → 401", async () => {
    expect(await checkWebhook("nope", body, S, new Date())).toMatchObject({ status: 401 });
    expect(await checkWebhook(null, body, S, new Date())).toMatchObject({ status: 401 });
  });
  it("9 KB body → 413", async () => expect(await checkWebhook(S, "a".repeat(9 * 1024), S, new Date())).toMatchObject({ status: 413 }));
  it("bad JSON → 422", async () => expect(await checkWebhook(S, "{", S, new Date())).toMatchObject({ status: 422 }));
  it("missing posted_at uses the receive time", async () => {
    const r = await checkWebhook(S, JSON.stringify({ source_app: "x", text: "y" }), S, new Date("2026-11-14T01:02:03Z"));
    expect(r.ok && r.body.posted_at).toBe("2026-11-14T01:02:03.000Z");
  });
  it("same text in the same minute → same id", async () =>
    expect(await webhookExternalId("a", "2026-11-14T05:00:10Z")).toBe(await webhookExternalId("a", "2026-11-14T05:00:50Z")));
});

describe("F-12.1 ingest + rate limit (PGlite)", () => {
  let pg: Pg;
  const U = "00000000-0000-4000-8000-0000000000ee";
  beforeAll(async () => {
    pg = await createDb();
    await addUser(pg, U);
    await pg.query(`select bootstrap_user($1)`, [U]);
  }, 60_000);
  it("creates one INGEST_EVENT (channel webhook); a resend is deduped", async () => {
    const db = ingestDb(pg);
    const b = { source_app: "Aplikasi lain", text: "Ada notifikasi", posted_at: "2026-11-14T05:00:00Z" };
    const id = await webhookExternalId(b.text, b.posted_at);
    await ingestWebhook(db, U, b, id, new Date());
    await ingestWebhook(db, U, b, id, new Date());
    expect((await pg.query(`select count(*)::int n from ingest_events where channel = 'webhook'`)).rows[0]).toEqual({ n: 1 });
  });
  it("LLM off and no parser → failed", async () => {
    await pg.query(`update app_settings set llm_enabled = false`);
    const db = ingestDb(pg);
    await ingestWebhook(db, U, { source_app: "Aplikasi lain", text: "Notif kedua", posted_at: "2026-11-14T06:00:00Z" }, "x2", new Date());
    expect((await pg.query(`select parse_status from ingest_events where external_id = 'x2'`)).rows[0]).toEqual({ parse_status: "failed" });
  });
  it("the 61st request in a minute is refused", async () => {
    let last = true;
    for (let i = 0; i < 61; i++) last = ((await pg.query<{ allowed: boolean }>(`select * from rpc_hit_rate_limit('webhook-test', 60, 60)`)).rows[0]).allowed;
    expect(last).toBe(false);
  });
});

describe("F-12.4 quick add (local parser first)", () => {
  it("kalimat tanpa angka → no amount", () => expect(parseQuickAdd("makan siang enak", ["OVO"]).amount).toBeNull());
});

import { b64u, encryptPayload, notifyOwner, vapidAuthorization } from "../../src/lib/ingest/push";

async function receiver() {
  const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { kp, sub: { p256dh: b64u.enc(pub), auth: b64u.enc(auth) }, pub, auth };
}
async function hk(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) {
  const k = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, k, n * 8));
}
async function decrypt(body: Uint8Array, r: Awaited<ReturnType<typeof receiver>>) {
  const te = new TextEncoder();
  const salt = body.slice(0, 16);
  const asPub = body.slice(21, 21 + body[20]);
  const ct = body.slice(21 + body[20]);
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, r.kp.privateKey, 256));
  const ikm = await hk(r.auth, shared, new Uint8Array([...te.encode("WebPush: info\0"), ...r.pub, ...asPub]), 32);
  const cek = await hk(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hk(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
  return new TextDecoder().decode(pt.slice(0, pt.lastIndexOf(2)));
}
async function vapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicKey: b64u.enc(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))), privateKey: jwk.d!, subject: "mailto:pemilik@contoh.example", verify: kp.publicKey };
}

describe("F-12.3 Web Push crypto", () => {
  it("aes128gcm payload decrypts with the subscriber key", async () => {
    const r = await receiver();
    expect(await decrypt(await encryptPayload('{"body":"3 transaksi perlu dicek."}', r.sub), r)).toBe('{"body":"3 transaksi perlu dicek."}');
  });
  it("VAPID JWT verifies with the public key", async () => {
    const v = await vapidKeys();
    const h = await vapidAuthorization("https://push.example/abc", v);
    const jwt = h.match(/t=([^,]+)/)![1];
    const [hd, pl, sig] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64u.dec(pl))).aud).toBe("https://push.example");
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, v.verify, b64u.dec(sig), new TextEncoder().encode(`${hd}.${pl}`))).toBe(true);
  });
});

describe("F-12.3 notify rules (PGlite)", () => {
  let pg: Pg;
  const U = "00000000-0000-4000-8000-0000000000ff";
  beforeAll(async () => {
    pg = await createDb();
    await addUser(pg, U);
    await pg.query(`select bootstrap_user($1)`, [U]);
  }, 60_000);
  it("batches Inbox pushes to one per 15 minutes, never sends amounts, honours the switch, drops 410 subscriptions", async () => {
    const r = await receiver();
    await pg.query(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/1', $2, $3)`, [U, r.sub.p256dh, r.sub.auth]);
    const v = await vapidKeys();
    const sent: string[] = [];
    const ok = (async (_u: unknown, init?: RequestInit) => { sent.push(await decrypt(new Uint8Array(init!.body as ArrayBuffer), r)); return new Response(null, { status: 201 }); }) as typeof fetch;
    const db = ingestDb(pg);
    expect(await notifyOwner(db, U, "inbox", "3 transaksi perlu dicek.", v, ok)).toBe(1);
    expect(await notifyOwner(db, U, "inbox", "4 transaksi perlu dicek.", v, ok)).toBe(0);
    expect(sent).toEqual(['{"body":"3 transaksi perlu dicek."}']);
    expect(sent.join()).not.toMatch(/Rp/);
    expect(await notifyOwner(db, U, "deposito", "Rp 50.000.000 jatuh tempo", v, ok)).toBe(0);
    await pg.query(`update app_settings set push_prefs = '{"inbox": false, "gmail": true, "deposito": true}'`);
    await pg.query(`update push_subscriptions set last_success_at = null`);
    expect(await notifyOwner(db, U, "inbox", "1 transaksi perlu dicek.", v, ok)).toBe(0);
    const gone = (async () => new Response(null, { status: 410 })) as typeof fetch;
    await notifyOwner(db, U, "gmail", "Gmail perlu dihubungkan ulang.", v, gone);
    expect((await pg.query(`select count(*)::int n from push_subscriptions`)).rows[0]).toEqual({ n: 0 });
  });
});

import manifest from "../../src/app/manifest";
describe("F-12.2 manifest", () => {
  it("share_target: action, POST, multipart, image/*", () => {
    const st = (manifest() as unknown as { share_target: { action: string; method: string; enctype: string; params: { files: { accept: string[] }[] } } }).share_target;
    expect(st).toMatchObject({ action: "/share-target", method: "POST", enctype: "multipart/form-data" });
    expect(st.params.files[0].accept).toContain("image/*");
  });
});

import { extractJson } from "../../src/lib/ingest/llm";
describe("LLM reply parsing (routers that ignore response_format)", () => {
  it("plain, fenced and prose-wrapped JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Berikut hasilnya: {"a":3} semoga membantu')).toEqual({ a: 3 });
  });
  it("prose without JSON → null", () => expect(extractJson("Gunakan regex untuk mengambil angka.")).toBeNull());
});

import { validateEmailResult } from "../../src/lib/ingest/llm";
describe("LLM flat replies are normalised, still validated", () => {
  const text = "Pembayaran Rp 11.000,00 ke MINIMARKET";
  const now = new Date("2026-11-03T00:00:00Z");
  it("flat object → one transaction", () =>
    expect(validateEmailResult({ ignored: false, amount: 11000, timestamp: "2026-09-17T17:58:38+07:00", recipient: "MINIMARKET" }, text, now).txs[0]).toMatchObject({ amount: 11000, direction: "out", kind_hint: "expense" }));
  it("an amount that is not in the text is still rejected", () =>
    expect(() => validateEmailResult({ amount: 12000, timestamp: "2026-09-17T10:00:00Z" }, text, now)).toThrow(/tidak ada di teks/));
});

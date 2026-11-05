// Web Push with WebCrypto only (RFC 8291 aes128gcm payloads, RFC 8292 VAPID). Works in Node and Deno.
// Payloads never contain amounts or merchant names (F-12.3).
import type { Db } from "./db";

export interface Vapid {
  publicKey: string; // base64url, 65-byte uncompressed P-256 point
  privateKey: string; // base64url, 32-byte scalar d
  subject: string; // mailto:...
}

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const b64u = {
  enc: (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};
export { b64u };

const cat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};
const te = new TextEncoder();
const buf = (u: Uint8Array) => u as unknown as BufferSource;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) }, key, bytes * 8));
}

/** RFC 8291 single-record aes128gcm body. */
export async function encryptPayload(payload: string, sub: { p256dh: string; auth: string }, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<Uint8Array> {
  const uaPublic = b64u.dec(sub.p256dh);
  const authSecret = b64u.dec(sub.auth);
  const eph = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", buf(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, cat(te.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", buf(cek), "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, key, buf(cat(te.encode(payload), new Uint8Array([2])))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return cat(header, asPublic, ct);
}

export async function vapidAuthorization(endpoint: string, v: Vapid, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const pub = b64u.dec(v.publicKey);
  const jwk = { kty: "EC", crv: "P-256", d: v.privateKey, x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = (o: object) => b64u.enc(te.encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: v.subject })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, buf(te.encode(unsigned))));
  return `vapid t=${unsigned}.${b64u.enc(sig)}, k=${v.publicKey}`;
}

export async function sendPush(sub: PushSub, text: string, v: Vapid, fetchFn: typeof fetch = fetch): Promise<"ok" | "gone" | "error"> {
  const body = await encryptPayload(JSON.stringify({ body: text }), sub);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchFn(sub.endpoint, {
      method: "POST",
      headers: { "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", authorization: await vapidAuthorization(sub.endpoint, v) },
      body: buf(body),
    }).catch(() => null);
    if (res && (res.status === 404 || res.status === 410)) return "gone";
    if (res?.ok) return "ok";
    // shortcut: retries are immediate with a short pause, not 1 minute apart; upgrade to a queued retry if delivery is flaky
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return "error";
}

export type PushKind = "inbox" | "gmail" | "deposito";

/** Sends one notification to every subscription of the owner, honouring the per-kind switch and the 15-minute Inbox batching. */
export async function notifyOwner(db: Db, uid: string, kind: PushKind, text: string, v: Vapid | null, fetchFn: typeof fetch = fetch): Promise<number> {
  if (!v || /rp/i.test(text)) return 0;
  const [st] = await db.q(`select push_prefs from app_settings where user_id = $1`, [uid]);
  if (st?.push_prefs?.[kind] === false) return 0;
  if (kind === "inbox") {
    const [recent] = await db.q(`select 1 from push_subscriptions where user_id = $1 and last_success_at > now() - interval '15 minutes' limit 1`, [uid]);
    if (recent) return 0;
  }
  let sent = 0;
  for (const s of await db.q(`select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1`, [uid])) {
    const r = await sendPush(s as PushSub, text, v, fetchFn);
    if (r === "ok") {
      sent++;
      await db.q(`update push_subscriptions set last_success_at = now() where id = $1`, [s.id]);
    } else if (r === "gone") await db.q(`delete from push_subscriptions where id = $1`, [s.id]);
  }
  return sent;
}

export function vapidFromEnv(env: Record<string, string | undefined>): Vapid | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? env.VAPID_PUBLIC_KEY;
  return publicKey && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT ? { publicKey, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT } : null;
}

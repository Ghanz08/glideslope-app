import "server-only";
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export const PIN_ITERATIONS = 210_000;
export const UNLOCK_COOKIE = "gs_unlock";

export function hashPin(pin: string, salt = randomBytes(16).toString("base64")) {
  const hash = pbkdf2Sync(pin, salt, PIN_ITERATIONS, 32, "sha256").toString("base64");
  return { hash, salt, iterations: PIN_ITERATIONS };
}

export function verifyPin(pin: string, hash: string, salt: string, iterations: number): boolean {
  const got = pbkdf2Sync(pin, salt, iterations, 32, "sha256");
  const want = Buffer.from(hash, "base64");
  return got.length === want.length && timingSafeEqual(got, want);
}

export const PIN_RE = /^[0-9]{6}$/;

const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

/** Unlock cookie value: "<uid>.<expiresMs>.<hmac>". Expiry = idle timeout, refreshed on activity. */
export function makeUnlockToken(uid: string, idleMinutes: number): { value: string; maxAge: number } {
  const exp = Date.now() + idleMinutes * 60_000;
  const payload = `${uid}.${exp}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: idleMinutes * 60 };
}

export function isUnlocked(token: string | undefined, uid: string): boolean {
  if (!token) return false;
  const [u, exp, mac] = token.split(".");
  if (u !== uid || !exp || !mac) return false;
  const expect = Buffer.from(sign(`${u}.${exp}`));
  const got = Buffer.from(mac);
  return expect.length === got.length && timingSafeEqual(expect, got) && Number(exp) > Date.now();
}

/** Constant-time string comparison for shared secrets (cron, webhook). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = createHmac("sha256", "cmp").update(a).digest();
  const y = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(x, y);
}

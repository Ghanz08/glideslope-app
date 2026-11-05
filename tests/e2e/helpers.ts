import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";

/** RFC 6238 TOTP from a base32 secret (the code shown during enrolment). */
export function totp(secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = secret.replace(/=+$/, "").toUpperCase().split("").map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export async function login(page: Page) {
  await page.goto("/masuk");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Kata sandi").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.getByLabel("Kode 6 angka dari autentikator").fill(totp(process.env.E2E_TOTP_SECRET!));
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL("/");
}

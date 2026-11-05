// Local e2e only: enrol TOTP for the test owner and append E2E_* values to .env.local (gitignored).
// Usage: npm run e2e:setup -- <email> <password>
import { createClient } from "@supabase/supabase-js";
import { appendFileSync, readFileSync } from "node:fs";
import { totp } from "../tests/e2e/helpers";

const [email, password] = process.argv.slice(2);
if (!email || !password) throw new Error("Pakai: npm run e2e:setup -- <email> <sandi>");
if (readFileSync(".env.local", "utf8").includes("E2E_TOTP_SECRET=")) {
  console.log("E2E sudah disiapkan.");
  process.exit(0);
}
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
const { error } = await s.auth.signInWithPassword({ email, password });
if (error) throw new Error(`Masuk gagal: ${error.message}`);
const { data, error: e2 } = await s.auth.mfa.enroll({ factorType: "totp", friendlyName: "e2e" });
if (e2 || !data) throw new Error(`Daftar TOTP gagal: ${e2?.message}`);
const v = await s.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) });
if (v.error) throw new Error(`Verifikasi TOTP gagal: ${v.error.message}`);
appendFileSync(".env.local", `E2E_EMAIL=${email}\nE2E_PASSWORD=${password}\nE2E_TOTP_SECRET=${data.totp.secret}\n`);
console.log("TOTP terdaftar; nilai E2E ditulis ke .env.local.");

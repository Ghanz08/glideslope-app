"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/server/supabase";
import { clearRateLimit, hitRateLimit, peekRateLimit } from "@/lib/server/owner";

const WINDOW = 15 * 60;
const MAX = 5;

export type LoginState =
  | { step: "sandi"; error?: string; email?: string }
  | { step: "mulai_daftar"; error?: string }
  | { step: "kode"; factorId: string; error?: string }
  | { step: "daftar"; factorId: string; qr: string; secret: string; error?: string };

const blockedMsg = (sec: number) => `Terlalu banyak percobaan. Coba lagi dalam ${Math.max(1, Math.ceil(sec / 60))} menit.`;

/** For rendering /masuk with an aal1 session: read-only, never enrols (a render must not replace a QR the owner just scanned). */
export async function currentFactorStep(): Promise<LoginState> {
  const s = await createClient();
  const { data } = await s.auth.mfa.listFactors();
  const verified = data?.totp?.find((f) => f.status === "verified");
  return verified ? { step: "kode", factorId: verified.id } : { step: "mulai_daftar" };
}

/** Called from actions only: which TOTP step comes next, enrolling a fresh factor when none is verified. */
export async function nextFactorStep(): Promise<LoginState> {
  const s = await createClient();
  const { data } = await s.auth.mfa.listFactors();
  const verified = data?.totp?.find((f) => f.status === "verified");
  if (verified) return { step: "kode", factorId: verified.id };
  for (const f of data?.all ?? []) if (f.status === "unverified") await s.auth.mfa.unenroll({ factorId: f.id });
  const { data: enrolled, error } = await s.auth.mfa.enroll({ factorType: "totp", friendlyName: `totp-${Date.now()}` });
  if (error || !enrolled) return { step: "sandi", error: "Pendaftaran autentikator belum bisa dimulai. Coba lagi." };
  return { step: "daftar", factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret };
}

export async function signInAction(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!password) return { step: "sandi", email, error: "Kata sandi wajib diisi." };
  const key = `login:${email}`;
  const peek = await peekRateLimit(key, WINDOW, MAX);
  if (!peek.allowed) return { step: "sandi", email, error: blockedMsg(peek.retryAfter) };

  const s = await createClient();
  const { error } = await s.auth.signInWithPassword({ email, password });
  if (error) {
    const hit = await hitRateLimit(key, WINDOW, MAX);
    return { step: "sandi", email, error: hit.allowed ? "Email atau kata sandi salah. Periksa lalu coba lagi." : blockedMsg(hit.retryAfter) };
  }
  return nextFactorStep();
}

export async function verifyCodeAction(prev: LoginState, form: FormData): Promise<LoginState> {
  if (prev.step === "sandi" || prev.step === "mulai_daftar") return prev;
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  const s = await createClient();
  const { data: user } = await s.auth.getUser();
  const key = `login:${user.user?.email ?? "unknown"}`;
  const peek = await peekRateLimit(key, WINDOW, MAX);
  if (!peek.allowed) return { ...prev, error: blockedMsg(peek.retryAfter) };
  if (!/^\d{6}$/.test(code)) return { ...prev, error: "Kode harus 6 angka." };

  const { error } = await s.auth.mfa.challengeAndVerify({ factorId: prev.factorId, code });
  if (error) {
    const hit = await hitRateLimit(key, WINDOW, MAX);
    return { ...prev, error: hit.allowed ? "Kode salah. Periksa jam di ponselmu lalu coba lagi." : blockedMsg(hit.retryAfter) };
  }
  await clearRateLimit(key);
  const lanjut = String(form.get("lanjut") ?? "");
  redirect(lanjut.startsWith("/") && !lanjut.startsWith("//") ? lanjut : "/");
}

export async function signOutAction() {
  const s = await createClient();
  await s.auth.signOut();
  redirect("/masuk");
}

export async function loginAction(prev: LoginState, form: FormData): Promise<LoginState> {
  if (prev.step === "sandi") return signInAction(prev, form);
  if (prev.step === "mulai_daftar") return nextFactorStep();
  return verifyCodeAction(prev, form);
}

import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient, createClient, type Supa } from "./supabase";
import { isUnlocked, UNLOCK_COOKIE } from "./pin";
import { apiError, type ApiError } from "./errors";

export interface Settings {
  user_id: string;
  graduation_date: string | null;
  emergency_reserve: number;
  burn_override: number | null;
  large_amount_threshold: number;
  idle_timeout_minutes: number;
  pin_enabled: boolean;
  redaction_terms: string[];
  payment_instructions: string | null;
  llm_enabled: boolean;
  auto_link_transfers: boolean;
  onboarding_step: number;
  gmail_prompt_dismissed_until: string | null;
  dismissed_banners: Record<string, string>;
  last_export_at: string | null;
  push_prefs: Record<string, boolean>;
}

const SETTINGS_COLUMNS =
  "user_id, graduation_date, emergency_reserve, burn_override, large_amount_threshold, idle_timeout_minutes, pin_hash, " +
  "redaction_terms, payment_instructions, llm_enabled, auto_link_transfers, onboarding_step, gmail_prompt_dismissed_until, " +
  "dismissed_banners, last_export_at, push_prefs";

export type Gate =
  | { state: "anon" }
  | { state: "aal1" }
  | { state: "locked"; userId: string; settings: Settings }
  | { state: "ok"; userId: string; supabase: Supa; settings: Settings };

/** Single place where access is decided (section 4.11). Pages, actions and routes reflect its result. */
export async function getGate(): Promise<Gate> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const c = claims?.claims;
  if (!c?.sub) return { state: "anon" };
  if (c.aal !== "aal2") return { state: "aal1" };

  const { data } = await supabase.from("app_settings").select(SETTINGS_COLUMNS).maybeSingle();
  let row = data as (Settings & { pin_hash: string | null }) | null;
  if (!row) {
    await supabase.rpc("rpc_bootstrap");
    row = (await supabase.from("app_settings").select(SETTINGS_COLUMNS).single()).data as typeof row;
  }
  if (!row) return { state: "anon" };
  const { pin_hash, ...rest } = row;
  const settings: Settings = {
    ...rest,
    emergency_reserve: Number(rest.emergency_reserve),
    burn_override: rest.burn_override == null ? null : Number(rest.burn_override),
    large_amount_threshold: Number(rest.large_amount_threshold),
    pin_enabled: !!pin_hash,
  };
  if (settings.pin_enabled) {
    const token = (await cookies()).get(UNLOCK_COOKIE)?.value;
    if (!isUnlocked(token, c.sub)) return { state: "locked", userId: c.sub, settings };
  }
  return { state: "ok", userId: c.sub, supabase, settings };
}

/** For pages: redirect when not allowed. Returns the owner context. */
export async function requireOwner(opts: { allowOnboarding?: boolean } = {}) {
  const gate = await getGate();
  if (gate.state === "anon") redirect("/masuk");
  if (gate.state === "aal1") redirect("/masuk?langkah=kode");
  if (gate.state === "locked") return gate;
  if (!opts.allowOnboarding && gate.settings.onboarding_step < 4) redirect("/mulai");
  return gate;
}

/** For Server Actions and Route Handlers: an error instead of a redirect. */
export async function ownerOrError(): Promise<
  { ok: true; userId: string; supabase: Supa; settings: Settings } | { ok: false; status: number; error: ApiError }
> {
  const gate = await getGate();
  if (gate.state === "anon") return { ok: false, status: 401, error: apiError("TANPA_SESI", "Silakan masuk dulu.") };
  if (gate.state === "aal1") return { ok: false, status: 403, error: apiError("BUTUH_KODE", "Masukkan kode autentikator dulu.") };
  if (gate.state === "locked") return { ok: false, status: 403, error: apiError("TERKUNCI", "Aplikasi terkunci. Masukkan PIN.") };
  return { ok: true, userId: gate.userId, supabase: gate.supabase, settings: gate.settings };
}

/** Fixed-window limiter backed by Postgres (service role). */
export async function hitRateLimit(key: string, windowSeconds: number, max: number) {
  const { data, error } = await createAdminClient().rpc("rpc_hit_rate_limit", {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
  if (error) return { allowed: true, retryAfter: 0 }; // limiter outage must not lock the owner out
  const r = (data as { allowed: boolean; retry_after_seconds: number }[])[0];
  return { allowed: r.allowed, retryAfter: r.retry_after_seconds };
}

export async function peekRateLimit(key: string, windowSeconds: number, max: number) {
  const { data, error } = await createAdminClient().rpc("rpc_peek_rate_limit", {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
  if (error) return { allowed: true, retryAfter: 0 };
  const r = (data as { allowed: boolean; retry_after_seconds: number }[])[0];
  return { allowed: r.allowed, retryAfter: r.retry_after_seconds };
}

export async function clearRateLimit(key: string) {
  await createAdminClient().rpc("rpc_clear_rate_limit", { p_key: key });
}

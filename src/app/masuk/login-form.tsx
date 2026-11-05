"use client";
import { useActionState, useState } from "react";
import { loginAction, type LoginState } from "./actions";
import { Button, Field, inputClass } from "@/components/ui";

export function LoginForm({ initial, lanjut }: { initial: LoginState; lanjut: string }) {
  const [state, act, pending] = useActionState(loginAction, initial);
  const [password, setPassword] = useState("");
  const passState = state;
  const current = state.step === "sandi" ? null : state;
  const signIn = act;
  const verify = act;
  const signingIn = pending;
  const verifying = pending;

  if (!current) {
    return (
      <form action={signIn} className="flex flex-col gap-4" noValidate>
        <Field label="Email" name="email">
          <input id="email" name="email" type="email" autoComplete="username" required defaultValue={passState.step === "sandi" ? passState.email : ""} className={inputClass()} />
        </Field>
        <Field label="Kata sandi" name="password" error={passState.step === "sandi" ? passState.error : undefined}>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={passState.step === "sandi" && passState.error ? "password-galat" : undefined}
            className={inputClass(passState.step === "sandi" ? passState.error : undefined)}
          />
        </Field>
        {!password && <p className="text-[13px] text-teks-pelan">Kata sandi wajib diisi.</p>}
        <Button type="submit" full disabled={!password || signingIn}>
          {signingIn ? "Memeriksa…" : "Masuk"}
        </Button>
      </form>
    );
  }

  if (current.step === "mulai_daftar") {
    return (
      <form action={verify} className="flex flex-col gap-4">
        <p className="text-[14px] text-teks-redup">Akunmu belum punya aplikasi autentikator. Buat kode QR baru lalu pindai dengan aplikasi autentikatormu.</p>
        {current.error && <p role="alert" className="text-[14px] text-galat">{current.error}</p>}
        <Button type="submit" full disabled={verifying}>{verifying ? "Menyiapkan…" : "Tampilkan kode QR"}</Button>
      </form>
    );
  }

  return (
    <form action={verify} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="lanjut" value={lanjut} />
      {current.step === "daftar" && (
        <div className="flex flex-col gap-3 rounded-strip bg-isian p-4 text-[14px]">
          <p className="font-semibold">Daftarkan aplikasi autentikator</p>
          <p className="text-teks-redup">Pindai kode QR ini dengan Google Authenticator, 1Password, atau aplikasi sejenis.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current.qr} alt="Kode QR untuk aplikasi autentikator" width={180} height={180} className="self-center rounded-petak bg-permukaan p-2" />
          <p className="text-teks-redup">
            Atau ketik kode manual: <code className="tabular font-semibold break-all text-teks">{current.secret}</code>
          </p>
        </div>
      )}
      <Field label="Kode 6 angka dari autentikator" name="code" error={current.error}>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]{6}"
          autoFocus
          aria-describedby={current.error ? "code-galat" : undefined}
          className={`${inputClass(current.error)} tabular text-[22px] tracking-[0.4em]`}
        />
      </Field>
      <Button type="submit" full disabled={verifying}>
        {verifying ? "Memeriksa…" : "Masuk"}
      </Button>
    </form>
  );
}

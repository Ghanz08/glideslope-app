import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getGate } from "@/lib/server/owner";
import { APP_NAME } from "@/lib/env";
import { currentFactorStep, type LoginState } from "./actions";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };

export default async function MasukPage({ searchParams }: { searchParams: Promise<{ lanjut?: string }> }) {
  const { lanjut = "/" } = await searchParams;
  const gate = await getGate();
  if (gate.state === "ok" || gate.state === "locked") redirect("/");
  const initial: LoginState = gate.state === "aal1" ? await currentFactorStep() : { step: "sandi" };
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px] rounded-kartu bg-permukaan p-7 shadow-e2">
        <p className="mb-1 text-[20px] font-bold">{APP_NAME}</p>
        <h1 className="mb-6 text-[15px] text-teks-redup">Masuk ke catatan keuanganmu</h1>
        <LoginForm initial={initial} lanjut={lanjut} />
      </div>
    </main>
  );
}

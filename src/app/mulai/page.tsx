import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LockScreen } from "@/components/lock";
import { requireOwner } from "@/lib/server/owner";
import { getAccounts, today } from "@/lib/server/queries";
import { APP_NAME } from "@/lib/env";
import { Onboarding } from "./onboarding";

export const metadata: Metadata = { title: "Mulai" };

export default async function MulaiPage() {
  const gate = await requireOwner({ allowOnboarding: true });
  if (gate.state === "locked") return <LockScreen />;
  if (gate.settings.onboarding_step >= 5) redirect("/");
  const accounts = await getAccounts(gate.supabase);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center px-4 py-10">
      <p className="mb-1 text-[20px] font-bold">{APP_NAME}</p>
      <h1 className="mb-6 text-[24px] font-bold">Siapkan runway kamu</h1>
      <div className="rounded-kartu bg-permukaan p-6 shadow-e2">
        <Onboarding
          step={gate.settings.onboarding_step}
          today={today()}
          graduation={gate.settings.graduation_date}
          reserve={gate.settings.emergency_reserve}
          burn={gate.settings.burn_override}
          accounts={accounts.map((a) => ({ name: a.name, balance: a.balance }))}
        />
      </div>
    </main>
  );
}

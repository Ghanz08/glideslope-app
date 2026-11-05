"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { recordRepayment } from "@/app/actions/split";
import { Button } from "@/components/ui";
import { toast } from "@/components/toast";

export function CashRepay({ id, remaining, accounts }: { id: string; remaining: number; accounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const [acc, setAcc] = useState(accounts.find((a) => /tunai/i.test(a.name))?.id ?? accounts[0]?.id ?? "");
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`akun-${id}`}>Akun tujuan</label>
      <select id={`akun-${id}`} value={acc} onChange={(e) => setAcc(e.target.value)} className="min-h-11 rounded-petak border border-garis-kontrol bg-permukaan px-2 text-[14px]">
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <Button variant="lembut" disabled={pending} onClick={() => start(async () => {
        const r = await recordRepayment(id, remaining, acc);
        if ("error" in r) return toast({ text: r.error.message, tone: "galat" });
        toast({ text: "Ditandai lunas." });
        router.refresh();
      })}>Tandai lunas tunai</Button>
    </span>
  );
}

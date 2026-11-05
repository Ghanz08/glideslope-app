"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AccountForm } from "@/components/account-form";
import { Button, Card } from "@/components/ui";
import { toast } from "@/components/toast";

export function NewAccount({ today, open }: { today: string; open: boolean }) {
  const router = useRouter();
  const [show, setShow] = useState(open);
  if (!show) return <Button variant="lembut" onClick={() => setShow(true)}>Tambah akun</Button>;
  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-[16px] font-bold">Akun baru</h2>
      <AccountForm today={today} onSaved={() => { setShow(false); toast({ text: "Akun tersimpan." }); router.refresh(); }} />
    </Card>
  );
}

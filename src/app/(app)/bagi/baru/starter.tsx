"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createSplitFrom } from "@/app/actions/split";
import { ButtonLink } from "@/components/ui";

export function Starter({ nota, transaksi }: { nota?: string; transaksi?: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void createSplitFrom({ nota, transaksi }).then((r) => ("ok" in r ? router.replace(`/bagi/${r.id}`) : setMsg(r.error.message)));
  }, [nota, transaksi, router]);
  return msg ? (
    <div className="flex flex-col gap-3">
      <p role="alert" className="text-[14px] text-galat">{msg}</p>
      {nota && <ButtonLink href={`/nota/${nota}`} variant="sekunder">Buka nota</ButtonLink>}
    </div>
  ) : <p aria-live="polite" className="text-[14px] text-teks-redup">Menyiapkan tagihan…</p>;
}

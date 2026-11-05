"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, inputClass } from "@/components/ui";
import { toast } from "@/components/toast";

type Usage = { available: false } | { available: true; db_mb: number; storage_mb: number; limits: { db_mb: number; storage_mb: number } };

export function DataSection({ pinEnabled, lastExport }: { pinEnabled: boolean; lastExport: string | null }) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    fetch("/api/storage-usage").then((r) => r.json()).then(setUsage).catch(() => setUsage({ available: false }));
  }, []);

  const exportNow = () =>
    start(async () => {
      setError(null);
      const res = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pinEnabled ? { pin: secret } : { code: secret }) }).catch(() => null);
      if (!res?.ok) {
        const body = await res?.json().catch(() => null);
        return setError(body?.error?.message ?? "Ekspor gagal. Periksa koneksi lalu coba lagi.");
      }
      const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "export.zip";
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      a.click();
      URL.revokeObjectURL(url);
      setSecret("");
      toast({ text: "Ekspor selesai." });
      router.refresh();
    });

  const bar = (used: number, limit: number, label: string) => (
    <div className="text-[14px]">
      <p className="flex justify-between"><span>{label}</span><span className="tabular">{used.toFixed(1).replace(".", ",")} / {limit} MB</span></p>
      <div className="mt-1 h-2 rounded-full bg-isian"><div className="h-2 rounded-full bg-aksen" style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} /></div>
      {used >= limit * 0.8 && <p className="mt-1 font-semibold text-peringatan">Pemakaian sudah 80% dari batas paket gratis.</p>}
    </div>
  );

  return (
    <div id="ekspor" className="flex flex-col gap-4">
      <p className="text-[14px] text-teks-redup">{lastExport ? `Ekspor terakhir ${new Date(lastExport).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}.` : "Belum pernah dicadangkan."} Paket gratis tidak punya cadangan otomatis.</p>
      <Field label={pinEnabled ? "PIN untuk verifikasi ulang" : "Kode autentikator untuk verifikasi ulang"} name="reverify" error={error ?? undefined}>
        <input id="reverify" type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={secret} onChange={(e) => setSecret(e.target.value.replace(/\D/g, ""))} className={`${inputClass(error ?? undefined)} tabular tracking-[0.3em]`} />
      </Field>
      <Button onClick={exportNow} disabled={pending || secret.length !== 6}>{pending ? "Menyiapkan…" : "Ekspor data"}</Button>
      <div className="flex flex-col gap-3 border-t border-garis pt-4">
        <h3 className="text-[15px] font-bold">Pemakaian penyimpanan</h3>
        {!usage ? <p className="text-[14px] text-teks-redup">Memuat…</p> : !usage.available ? <p className="text-[14px] text-teks-redup">Tidak tersedia</p> : (
          <>
            {bar(usage.db_mb, usage.limits.db_mb, "Basis data")}
            {bar(usage.storage_mb, usage.limits.storage_mb, "Gambar nota")}
          </>
        )}
      </div>
    </div>
  );
}

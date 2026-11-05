"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, Image as ImageIcon } from "lucide-react";
import { createManualReceipt, uploadReceipt } from "@/app/actions/receipts";
import { prepareReceiptImage } from "@/lib/client/image";
import { Button, buttonClass } from "@/components/ui";

export function Uploader({ shared }: { shared: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const handle = (file: File | undefined) =>
    file &&
    start(async () => {
      setMsg(null);
      const prepared = await prepareReceiptImage(file).catch(() => "Foto tidak bisa dibaca.");
      if (typeof prepared === "string") return setMsg(prepared);
      const form = new FormData();
      form.set("file", new File([prepared], "nota.jpg", { type: "image/jpeg" }));
      setMsg("Membaca nota… maksimal 30 detik.");
      const r = await uploadReceipt(form).catch(() => null);
      if (!r) return setMsg("Tidak ada koneksi. Nota belum terunggah.");
      if ("error" in r) return setMsg(r.error.message);
      router.push(`/nota/${r.id}`);
    });

  // F-12.2: an image shared from the OS share sheet was parked by the service worker
  useEffect(() => {
    if (!shared || !("caches" in window)) return;
    void caches.open("gs-share").then(async (c) => {
      const res = await c.match("/shared-image");
      const expired = Number(res?.headers.get("x-expires") ?? 0) < Date.now();
      await c.delete("/shared-image");
      if (!res || expired) return setMsg("Gambar yang dibagikan sudah kedaluwarsa. Pilih ulang.");
      const blob = await res.blob();
      handle(new File([blob], "bagikan", { type: blob.type || "image/jpeg" }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);

  return (
    <div className="flex flex-col gap-4">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={pending} onClick={() => camera.current?.click()} className={buttonClass("utama")}><Camera size={18} aria-hidden />Ambil foto</button>
        <button type="button" disabled={pending} onClick={() => picker.current?.click()} className={buttonClass("sekunder")}><ImageIcon size={18} aria-hidden />Pilih berkas</button>
      </div>
      <p aria-live="polite" className="min-h-5 text-[14px] text-teks-redup">{msg}</p>
      <Button variant="teks" disabled={pending} onClick={() => start(async () => {
        const r = await createManualReceipt();
        if ("ok" in r) router.push(`/nota/${r.id}`);
      })}>Isi nota manual tanpa foto</Button>
    </div>
  );
}

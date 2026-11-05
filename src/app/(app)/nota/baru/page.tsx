import type { Metadata } from "next";
import { requireOwner } from "@/lib/server/owner";
import { Banner, Card, PageTitle } from "@/components/ui";
import { Uploader } from "./uploader";

export const metadata: Metadata = { title: "Scan nota" };

export default async function NotaBaru({ searchParams }: { searchParams: Promise<{ shared?: string; lebih?: string; format?: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const sp = await searchParams;
  return (
    <>
      <PageTitle title="Scan nota" subtitle="Foto dikecilkan dulu sebelum diunggah. Hasilnya selalu kamu tinjau." />
      {!process.env.OCR_URL && <div className="mb-4"><Banner tone="perhatian">Layanan OCR belum diatur, jadi nota tidak dibaca otomatis. Kamu tetap bisa mengisinya manual.</Banner></div>}
      {sp.format === "salah" && <div className="mb-4"><Banner tone="galat">Berkas yang dibagikan bukan gambar. Pilih foto JPEG, PNG, atau WebP.</Banner></div>}
      {sp.shared === "0" && <div className="mb-4"><Banner>Gambar yang dibagikan belum tersimpan. Pilih berkasnya lagi di bawah.</Banner></div>}
      {sp.lebih === "1" && <div className="mb-4"><Banner>Hanya gambar pertama yang diproses; sisanya diabaikan.</Banner></div>}
      <Card className="max-w-[560px]"><Uploader shared={sp.shared === "1"} /></Card>
    </>
  );
}

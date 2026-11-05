import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-[24px] font-bold">Halaman tidak ditemukan</h1>
      <p className="text-teks-redup">Alamat ini tidak ada atau sudah dipindah.</p>
      <ButtonLink href="/">Kembali ke Beranda</ButtonLink>
    </main>
  );
}

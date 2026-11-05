export default function Offline() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-[22px] font-bold">Tidak ada koneksi</h1>
      <p className="max-w-sm text-teks-redup">Data keuangan tidak disimpan di perangkat. Sambungkan internet lalu muat ulang.</p>
    </main>
  );
}

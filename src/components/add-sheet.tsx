"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Camera, ChevronRight, Users, X } from "lucide-react";

const ROWS = [
  { href: "/tambah/pengeluaran", icon: ArrowUpRight, title: "Pengeluaran", body: "Belanja, makan, atau tagihan" },
  { href: "/tambah/pemasukan", icon: ArrowDownLeft, title: "Pemasukan", body: "Uang saku, honor, atau transfer masuk" },
  { href: "/tambah/transfer", icon: ArrowLeftRight, title: "Transfer antar akun", body: "Pindah saldo, bukan pemasukan" },
  { href: "/nota/baru", icon: Camera, title: "Scan nota", body: "Foto nota, dicocokkan dengan email" },
  { href: "/bagi/baru", icon: Users, title: "Bagi tagihan", body: "Pecah nota untuk beberapa teman" },
];

/** S-06: bottom sheet on mobile, centred dialog from 768 px. Escape and backdrop clicks close it. */
export function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="judul-tambah"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="fixed inset-x-0 bottom-0 m-0 mt-auto w-full max-w-none rounded-t-lembar bg-permukaan p-0 shadow-e3 md:m-auto md:max-w-[480px] md:rounded-kartu"
    >
      {open && <div className="px-5 pt-3 pb-6">
        <span aria-hidden className="mx-auto mb-4 block h-1 w-10 rounded-full bg-garis md:hidden" />
        <div className="mb-2 flex items-center justify-between">
          <h2 id="judul-tambah" className="text-[22px] font-bold">Tambah</h2>
          <button type="button" aria-label="Tutup" onClick={() => ref.current?.close()} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-isian">
            <X size={22} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <ul>
          {ROWS.map((r) => (
            <li key={r.href} className="border-b border-garis last:border-0">
              <Link href={r.href} onClick={() => ref.current?.close()} className="flex min-h-[68px] items-center gap-4 py-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-petak bg-aksen-lembut text-aksen">
                  <r.icon size={20} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="flex-1">
                  <span className="block text-[16px] font-semibold">{r.title}</span>
                  <span className="text-[14px] text-teks-redup">{r.body}</span>
                </span>
                <ChevronRight size={20} strokeWidth={1.75} aria-hidden className="text-teks-redup" />
              </Link>
            </li>
          ))}
        </ul>
      </div>}
    </dialog>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AddSheet } from "./add-sheet";
import { ChartColumn, House, Inbox, List, Plus, Settings, Wallet } from "lucide-react";
import { Badge, buttonClass, cx } from "./ui";

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

export function Sidebar({ appName, inboxCount }: { appName: string; inboxCount: number }) {
  const path = usePathname();
  const main = [
    { href: "/", label: "Beranda", icon: House },
    { href: "/inbox", label: "Inbox", icon: Inbox, badge: inboxCount },
    { href: "/transaksi", label: "Transaksi", icon: List },
    { href: "/analitik", label: "Analitik", icon: ChartColumn },
    { href: "/aset", label: "Aset", icon: Wallet },
  ];
  const sub = [
    { href: "/akun", label: "Rekening & wallet" },
    { href: "/aset", label: "Deposito & investasi", exact: true },
    { href: "/piutang", label: "Piutang" },
  ];
  const more = [
    { href: "/sumber", label: "Sumber email" },
    { href: "/langganan", label: "Langganan" },
    { href: "/label", label: "Label" },
    { href: "/rencana", label: "Rencana pengeluaran" },
  ];
  const item = (active: boolean) =>
    cx(
      "flex min-h-11 items-center gap-3 rounded-strip px-4 text-[15px] font-medium",
      active ? "bg-aksen-lembut font-semibold text-aksen" : "text-teks hover:bg-isian",
    );
  return (
    <nav aria-label="Navigasi utama" className="fixed inset-y-0 left-0 z-[10] hidden w-[248px] flex-col gap-1 border-r border-garis bg-latar px-4 py-7 lg:flex">
      <Link href="/" className="mb-6 px-3 text-[20px] font-bold tracking-tight">
        {appName}
      </Link>
      <Link href="/tambah/pengeluaran" className={cx(buttonClass("utama", true), "mb-6")}>
        <Plus size={18} strokeWidth={2} aria-hidden /> Catat transaksi
      </Link>
      {main.map((m) => (
        <Link key={m.href} href={m.href} aria-current={isActive(path, m.href) ? "page" : undefined} className={item(isActive(path, m.href))}>
          <m.icon size={20} strokeWidth={1.75} aria-hidden />
          <span className="flex-1">{m.label}</span>
          {m.badge ? <Badge n={m.badge} label={`${m.badge} item perlu dicek`} /> : null}
        </Link>
      ))}
      <div className="ml-8 flex flex-col">
        {sub.map((s) => (
          <Link key={s.label} href={s.href} className="flex min-h-11 items-center px-3 text-[14px] text-teks-redup hover:text-teks">
            {s.label}
          </Link>
        ))}
      </div>
      <p className="mt-4 px-4 text-[12px] font-semibold tracking-wide text-teks-pelan uppercase">Lainnya</p>
      {more.map((s) => (
        <Link key={s.href} href={s.href} aria-current={isActive(path, s.href) ? "page" : undefined} className={item(isActive(path, s.href))}>
          {s.label}
        </Link>
      ))}
      <div className="flex-1" />
      <Link href="/pengaturan" aria-current={isActive(path, "/pengaturan") ? "page" : undefined} className={item(isActive(path, "/pengaturan"))}>
        <Settings size={20} strokeWidth={1.75} aria-hidden /> Pengaturan
      </Link>
    </nav>
  );
}

export function BottomNav({ inboxCount }: { inboxCount: number }) {
  const path = usePathname();
  const [adding, setAdding] = useState(false);
  const tabs = [
    { href: "/", label: "Beranda", icon: House },
    { href: "/inbox", label: "Inbox", icon: Inbox, badge: inboxCount },
    null,
    { href: "/transaksi", label: "Transaksi", icon: List },
    { href: "/aset", label: "Aset", icon: Wallet },
  ];
  return (
    <nav aria-label="Navigasi utama" className="fixed inset-x-0 bottom-0 z-[10] h-20 border-t border-garis bg-permukaan pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto grid h-full max-w-[720px] grid-cols-5 items-center">
        {tabs.map((t) =>
          t === null ? (
            <li key="plus" className="flex justify-center">
              <button
                type="button"
                id="tombol-tambah"
                aria-label="Tambah transaksi"
                aria-haspopup="dialog"
                onClick={() => setAdding(true)}
                className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-aksen text-white shadow-e2"
              >
                <Plus size={26} strokeWidth={2} aria-hidden />
              </button>
            </li>
          ) : (
            <li key={t.href} className="flex justify-center">
              <Link
                href={t.href}
                aria-current={isActive(path, t.href) ? "page" : undefined}
                className={cx("flex min-h-11 flex-col items-center gap-1 text-[12px] font-medium", isActive(path, t.href) ? "text-aksen" : "text-teks-redup")}
              >
                <span className={cx("relative flex h-8 w-14 items-center justify-center rounded-full", isActive(path, t.href) && "bg-aksen-lembut")}>
                  <t.icon size={22} strokeWidth={1.75} aria-hidden />
                  {t.badge ? (
                    <span className="absolute -top-1 right-2">
                      <Badge n={t.badge} label={`${t.badge} item perlu dicek`} />
                    </span>
                  ) : null}
                </span>
                {t.label}
              </Link>
            </li>
          ),
        )}
      </ul>
      <AddSheet open={adding} onClose={() => setAdding(false)} />
    </nav>
  );
}

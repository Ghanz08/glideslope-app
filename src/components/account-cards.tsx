import Link from "next/link";
import { ChevronRight, CircleCheck, Landmark, Mail, PenLine, TriangleAlert, Wallet, Banknote } from "lucide-react";
import type { AccountRow } from "@/lib/server/queries";
import { formatJt, formatRupiah } from "@/lib/core/money";
import { Secret, buttonClass, cx } from "./ui";

const KIND_ICON = { bank: Landmark, ewallet: Wallet, cash: Banknote };
const KIND_LABEL = { bank: "Bank", ewallet: "e-wallet", cash: "Tunai" };

export function SourceLabel({ label }: { label: AccountRow["label"] }) {
  const Icon = label.kind === "cocok" ? CircleCheck : label.kind === "email" ? Mail : label.kind === "selisih" ? TriangleAlert : PenLine;
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[13px]", label.kind === "selisih" ? "text-peringatan" : "text-teks-redup")}>
      <Icon size={16} strokeWidth={1.75} aria-hidden />
      <span className="truncate">{label.text}</span>
    </span>
  );
}

/** Amount that shrinks to a 16 px floor before an ellipsis, never silently cutting digits. */
function FitAmount({ value, className }: { value: number; className?: string }) {
  const text = formatRupiah(value);
  const size = text.length <= 13 ? 26 : text.length <= 16 ? 22 : text.length <= 19 ? 18 : 16;
  return (
    <p className={cx("tabular truncate font-bold tracking-[-0.02em]", className)} style={{ fontSize: size }}>
      <Secret mask="Rp ••••••">{text}</Secret>
    </p>
  );
}

/** Mobile (< 1024 px): horizontal snap row of 224 × 141 cards. */
export function AccountCardRow({ accounts, monthSpend }: { accounts: AccountRow[]; monthSpend: number }) {
  if (!accounts.length) {
    return (
      <Link href="/akun?baru=1" className={cx(buttonClass("lembut"), "w-full")}>
        Tambah akun pertama
      </Link>
    );
  }
  const total = accounts.reduce((a, x) => a + x.balance, 0);
  return (
    <ul aria-label="Akun" className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
      <li className="snap-start">
        <Link href="/akun" className="flex h-[141px] w-[224px] flex-col justify-between rounded-kartu bg-aksen p-4 text-white shadow-e2">
          <span>
            <span className="block text-[15px] font-bold">Rekening & wallet</span>
            <span className="text-[13px] opacity-90">{accounts.length} akun · siap pakai</span>
          </span>
          <span>
            <FitAmount value={total} />
            <span className="text-[13px] opacity-90">Keluar Rp {formatJt(monthSpend)} bulan ini</span>
          </span>
        </Link>
      </li>
      {accounts.map((a) => {
        const Icon = KIND_ICON[a.kind];
        return (
          <li key={a.id} className="snap-start">
            <Link href={`/akun/${a.id}`} className="flex h-[141px] w-[224px] flex-col justify-between rounded-kartu bg-permukaan p-4 shadow-e2">
              <span className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-petak bg-isian text-teks-redup">
                  <Icon size={20} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-bold">{a.name}</span>
                  <span className="tabular text-[13px] text-teks-redup">{a.last4 ? `••${a.last4}` : KIND_LABEL[a.kind]}</span>
                </span>
              </span>
              <span className="min-w-0">
                <FitAmount value={a.balance} />
                <SourceLabel label={a.label} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Desktop (≥ 1280 px) right-rail stack: total card, top 3 accounts, "Aset lain" link. */
export function AccountStack({ accounts, monthSpend, otherAssets }: { accounts: AccountRow[]; monthSpend: number; otherAssets: number }) {
  const total = accounts.reduce((a, x) => a + x.balance, 0);
  return (
    <div className="flex flex-col">
      <Link href="/akun" className="relative z-[1] rounded-kartu bg-aksen p-6 text-white shadow-e2">
        <span className="flex justify-between text-[15px] font-bold">
          Rekening & wallet <span className="text-[13px] font-medium opacity-90">{accounts.length} akun</span>
        </span>
        <FitAmount value={total} className="mt-6 !text-[32px]" />
        <span className="text-[13px] opacity-90">Keluar Rp {formatJt(monthSpend)} bulan ini</span>
      </Link>
      <ul className="-mt-4 rounded-b-kartu bg-permukaan pt-4 shadow-e1">
        {accounts.slice(0, 3).map((a) => {
          const Icon = KIND_ICON[a.kind];
          return (
            <li key={a.id} className="border-b border-garis last:border-0">
              <Link href={`/akun/${a.id}`} className="flex min-h-[60px] items-center gap-3 px-5">
                <span className="flex h-8 w-8 items-center justify-center rounded-petak-kecil bg-isian text-teks-redup">
                  <Icon size={16} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="font-semibold">{a.name}</span>
                <span className="tabular text-[13px] text-teks-pelan">{a.last4 ? `••${a.last4}` : KIND_LABEL[a.kind]}</span>
                <Secret mask="Rp ••••••" className="tabular ml-auto font-semibold">{formatRupiah(a.balance)}</Secret>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link href="/aset" className="mt-3 flex min-h-11 items-center justify-between px-1 text-[15px]">
        <span className="text-teks-redup">Aset lain</span>
        <span className="tabular flex items-center gap-1 font-semibold">
          <Secret mask="Rp ••••••">{formatRupiah(otherAssets)}</Secret> <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
        </span>
      </Link>
    </div>
  );
}

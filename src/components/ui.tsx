// Shared presentational components. Styling only from tokens in globals.css.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import {
  Briefcase, Bus, CircleAlert, CircleEllipsis, Gift, GraduationCap, House, Info, Landmark, ArrowLeftRight, Music,
  Package, Receipt, SquarePlus, TriangleAlert, Utensils, Wallet, type LucideIcon,
} from "lucide-react";
import { formatRupiah } from "@/lib/core/money";
import { monogram, toneFor } from "@/lib/core/domain";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------- buttons
type Variant = "utama" | "sekunder" | "lembut" | "teks" | "bahaya";
const VARIANTS: Record<Variant, string> = {
  utama: "bg-aksen text-white hover:brightness-110 active:brightness-95",
  sekunder: "bg-isian text-teks hover:bg-garis",
  lembut: "bg-aksen-lembut text-aksen hover:brightness-95",
  teks: "text-teks-redup hover:bg-isian",
  bahaya: "bg-galat-latar text-galat hover:brightness-95",
};
export const buttonClass = (v: Variant = "utama", full = false) =>
  cx(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[14px] font-semibold",
    "transition-[filter,background-color] duration-cepat ease-standar disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[v],
    full && "w-full",
  );

export function Button({ variant = "utama", full, className, ...p }: ComponentProps<"button"> & { variant?: Variant; full?: boolean }) {
  return <button type="button" {...p} className={cx(buttonClass(variant, full), className)} />;
}

export function ButtonLink({ variant = "utama", full, className, ...p }: ComponentProps<typeof Link> & { variant?: Variant; full?: boolean }) {
  return <Link {...p} className={cx(buttonClass(variant, full), className)} />;
}

// ---------------------------------------------------------------- surfaces
export function Card({ className, flat, focus, ...p }: ComponentProps<"section"> & { flat?: boolean; focus?: boolean }) {
  return (
    <section
      {...p}
      // callers pass "p-0" for edge-to-edge lists; drop the default so the two don't fight in the cascade
      className={cx("rounded-kartu bg-permukaan", /(^|\s)p-0(\s|$)/.test(className ?? "") ? "" : "p-5", flat ? "" : focus ? "shadow-e3" : "shadow-e2", className)}
    />
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3 lg:mb-7">
      <div>
        <h1 className="text-[24px] leading-[30px] font-bold lg:text-[28px] lg:leading-9">{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-teks-redup">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

// ---------------------------------------------------------------- privacy
/**
 * A balance or account number that the privacy toggle can hide. Both versions are in the markup; the
 * `data-privasi` attribute on the app shell (from a cookie, so there is no flash) decides which one shows.
 */
export function Secret({ children, mask = "••••••", className }: { children: ReactNode; mask?: string; className?: string }) {
  return (
    <span className={cx("rahasia", className)} data-mask={mask}>
      {children}
    </span>
  );
}

/** "081234567890" → "0812 3456 7890"; the masked form keeps only the last 4 digits. */
export const groupDigits = (n: string) => n.replace(/(\d{4})(?=\d)/g, "$1 ");
export const maskNumber = (n: string) => `•••• ${n.slice(-4)}`;

// ---------------------------------------------------------------- money
export function BigAmount({ value, size = "hero", sign, secret }: { value: number; size?: "hero" | "numpad"; sign?: "−" | "+"; secret?: boolean }) {
  const digits = formatRupiah(Math.abs(value)).replace("Rp ", "");
  return (
    <span className="tabular inline-flex items-baseline gap-1.5">
      {sign && <span className="text-[28px] font-bold">{sign}</span>}
      <span className={cx("font-semibold text-teks-pelan", size === "hero" ? "text-[20px] leading-[30px] lg:text-[26px] lg:leading-10" : "text-[22px]")}>
        Rp
      </span>
      <span
        data-mask={secret ? "••••••" : undefined}
        className={cx(
          "font-bold tracking-[-0.03em]",
          secret && "rahasia",
          size === "hero" ? "text-[38px] leading-[46px] lg:text-[52px] lg:leading-[64px]" : "text-[44px] leading-[52px]",
        )}
      >
        {value < 0 && !sign ? "−" : ""}
        {digits}
      </span>
    </span>
  );
}

/** Signed amount for transaction rows: "−Rp 28.000" / "+Rp 105.000" (green only with the sign). */
export function TxAmount({ amount, direction, kind }: { amount: number; direction: "in" | "out"; kind?: string }) {
  const neutral = kind === "transfer";
  return (
    <span className={cx("tabular text-[15px] font-semibold lg:text-[14px]", direction === "in" && !neutral && "text-masuk")}>
      {direction === "in" ? "+" : "−"}
      {formatRupiah(amount)}
    </span>
  );
}

// ---------------------------------------------------------------- category tile
export const ICONS: Record<string, LucideIcon> = {
  utensils: Utensils, house: House, music: Music, package: Package, "graduation-cap": GraduationCap,
  "square-plus": SquarePlus, bus: Bus, receipt: Receipt, landmark: Landmark, "circle-ellipsis": CircleEllipsis,
  wallet: Wallet, briefcase: Briefcase, gift: Gift, transfer: ArrowLeftRight,
};
const TONES: Record<string, string> = {
  makan: "bg-makan-latar text-makan", rumah: "bg-rumah-latar text-rumah", hiburan: "bg-hiburan-latar text-hiburan",
  belanja: "bg-belanja-latar text-belanja", pendidikan: "bg-pendidikan-latar text-pendidikan", netral: "bg-netral-latar text-netral",
  kesehatan: "bg-kesehatan-latar text-kesehatan", transportasi: "bg-transportasi-latar text-transportasi", tagihan: "bg-tagihan-latar text-tagihan",
  piutang: "bg-netral-latar text-netral",
};
export const toneClass = (tone?: string | null) => TONES[tone ?? "netral"] ?? TONES.netral;

/** Category icon tile; uncategorised items with a `name` get a stable coloured monogram instead of a generic icon. */
export function CategoryTile({ icon, tone, size = 40, name }: { icon?: string | null; tone?: string | null; size?: 32 | 36 | 40 | 44 | 52; name?: string }) {
  const mono = name && (!icon || icon === "circle-ellipsis");
  const Icon = ICONS[icon ?? "circle-ellipsis"] ?? CircleEllipsis;
  return (
    <span
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center", size >= 44 ? "rounded-petak" : "rounded-petak-kecil", toneClass(mono ? toneFor(name) : tone))}
      style={{ width: size, height: size }}
    >
      {mono ? (
        <span className="font-bold tracking-[-0.02em]" style={{ fontSize: Math.round(size * 0.36) }}>{monogram(name)}</span>
      ) : (
        <Icon size={size >= 44 ? 22 : 18} strokeWidth={1.75} />
      )}
    </span>
  );
}

export function CategoryChip({ name, icon, tone }: { name: string; icon?: string | null; tone?: string | null }) {
  const Icon = ICONS[icon ?? "circle-ellipsis"] ?? CircleEllipsis;
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold", toneClass(tone))}>
      <Icon size={14} strokeWidth={1.75} aria-hidden />
      {name}
    </span>
  );
}

// ---------------------------------------------------------------- notices
export function Banner({ tone = "info", children, action }: { tone?: "info" | "perhatian" | "galat"; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === "info" ? Info : tone === "perhatian" ? TriangleAlert : CircleAlert;
  return (
    <div
      role={tone === "galat" ? "alert" : "status"}
      className={cx(
        "flex items-start gap-3 rounded-strip px-4 py-3 text-[14px]",
        tone === "info" && "bg-aksen-lembut text-aksen",
        tone === "perhatian" && "bg-peringatan-latar text-peringatan",
        tone === "galat" && "bg-galat-latar text-galat",
      )}
    >
      <Icon size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, body, action }: { icon?: LucideIcon; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Icon size={28} strokeWidth={1.75} className="text-teks-pelan" aria-hidden />
      <p className="text-[15px] font-semibold">{title}</p>
      {body && <p className="max-w-sm text-[14px] text-teks-redup">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = "Data belum bisa dimuat.", retryHref }: { message?: string; retryHref: string }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <CircleAlert size={24} strokeWidth={1.75} className="text-galat" aria-hidden />
      <p className="text-[14px] text-teks-redup">{message} Periksa koneksi lalu coba lagi.</p>
      <ButtonLink href={retryHref} variant="sekunder">
        Coba lagi
      </ButtonLink>
    </div>
  );
}

// ---------------------------------------------------------------- form fields
export function Field({
  label, name, error, hint, children,
}: { label: string; name: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-[13px] font-semibold text-teks-redup">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-[12px] text-teks-pelan">{hint}</p>}
      {error && (
        <p id={`${name}-galat`} className="text-[13px] text-galat" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass = (error?: string) =>
  cx(
    "min-h-11 w-full rounded-petak border bg-permukaan px-3 text-[15px] text-teks placeholder:text-teks-pelan",
    error ? "border-galat" : "border-garis-kontrol",
  );

export function Segmented({ options, value, hrefFor, label }: {
  options: { value: string; label: string; count?: number }[];
  value: string;
  hrefFor: (v: string) => string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-isian p-1">
      {options.map((o) => (
        <Link
          key={o.value}
          href={hrefFor(o.value)}
          aria-current={o.value === value ? "page" : undefined}
          scroll={false}
          className={cx(
            "inline-flex h-10 shrink-0 items-center gap-1 rounded-full px-4 text-[14px] font-semibold whitespace-nowrap",
            o.value === value ? "bg-permukaan text-teks shadow-e1" : "text-teks-redup hover:text-teks",
          )}
        >
          {o.label}
          {o.count != null && <span className="tabular">{o.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Badge({ n, label }: { n: number; label?: string }) {
  if (!n) return null;
  return (
    <span aria-label={label ?? `${n} item`} className="tabular inline-flex min-w-5 items-center justify-center rounded-full bg-teks px-1.5 text-[12px] font-bold text-white">
      {n}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-petak bg-isian", className)} />;
}

/** Submit without React 19's automatic form reset, so values stay after a failed save (section 4.7). */
export const keepValues = (fn: (form: FormData, el: HTMLFormElement) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  fn(new FormData(e.currentTarget), e.currentTarget);
};

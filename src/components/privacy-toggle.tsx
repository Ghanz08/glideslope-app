"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { PRIVACY_COOKIE } from "@/lib/privacy-cookie";
import { cx } from "./ui";

/**
 * Eye button that hides or shows balances and account numbers app-wide. Flips the shell's data-privasi attribute
 * (CSS does the rest, nothing re-renders) and remembers the choice in a cookie so the server renders it hidden next time.
 */
export function PrivacyToggle({ initial, className }: { initial: boolean; className?: string }) {
  const [hidden, setHidden] = useState(initial);
  const flip = () => {
    const next = !hidden;
    setHidden(next);
    for (const el of document.querySelectorAll<HTMLElement>("[data-privasi]")) el.dataset.privasi = next ? "on" : "off";
    document.cookie = `${PRIVACY_COOKIE}=${next ? "on" : "off"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <button type="button" onClick={flip} aria-pressed={hidden} aria-label={hidden ? "Tampilkan saldo dan nomor" : "Sembunyikan saldo dan nomor"}
      title={hidden ? "Tampilkan saldo dan nomor" : "Sembunyikan saldo dan nomor"}
      className={cx("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-teks-redup hover:bg-isian hover:text-teks", className)}>
      {hidden ? <EyeOff size={20} strokeWidth={1.75} aria-hidden /> : <Eye size={20} strokeWidth={1.75} aria-hidden />}
    </button>
  );
}

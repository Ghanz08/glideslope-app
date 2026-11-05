"use client";
// Global toast (max one visible). Fire with `toast()` from any client component.
import { useEffect, useState } from "react";
import { cx } from "./ui";

type ToastMsg = { text: string; tone?: "sukses" | "galat"; action?: { label: string; run: () => void }; ms?: number };

export function toast(msg: ToastMsg) {
  // survives a full reload (e.g. router.back() to a page that was loaded directly); actions are not replayed
  try {
    sessionStorage.setItem("gs-toast", JSON.stringify({ text: msg.text, tone: msg.tone, at: Date.now() }));
  } catch {}
  window.dispatchEvent(new CustomEvent<ToastMsg>("gs-toast", { detail: msg }));
}

export function Toaster() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      const m = (e as CustomEvent<ToastMsg>).detail;
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), m.ms ?? (m.action ? 6000 : 3500));
    };
    window.addEventListener("gs-toast", on);
    try {
      const saved = JSON.parse(sessionStorage.getItem("gs-toast") ?? "null") as (ToastMsg & { at: number }) | null;
      sessionStorage.removeItem("gs-toast");
      if (saved && Date.now() - saved.at < 3000) on(new CustomEvent("gs-toast", { detail: { text: saved.text, tone: saved.tone } }));
    } catch {}
    return () => window.removeEventListener("gs-toast", on);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[50] flex justify-center px-4 lg:bottom-8">
      {msg && (
        <div className={cx("pointer-events-auto flex items-center gap-4 rounded-full px-5 py-3 text-[14px] font-medium text-white shadow-e3", msg.tone === "galat" ? "bg-galat" : "bg-teks")}>
          <span>{msg.text}</span>
          {msg.action && (
            <button type="button" className="min-h-11 font-bold underline" onClick={() => { msg.action!.run(); setMsg(null); }}>
              {msg.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

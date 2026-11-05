"use client";
// S-02 lock overlay and idle watcher (F-01.2). The server decides whether content renders;
// these components only collect the PIN and report idleness.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Delete, Lock } from "lucide-react";
import { cx } from "./ui";

export function LockScreen({ onUnlocked }: { onUnlocked?: () => void }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(value: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/pin/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: value }) });
      if (res.ok) {
        onUnlocked?.();
        return router.refresh();
      }
      const body = await res.json().catch(() => null);
      if (body?.error?.code === "SESI_BERAKHIR") return router.replace("/masuk");
      setMsg(body?.error?.message ?? "PIN salah.");
    } catch {
      setMsg("Tidak bisa memeriksa PIN. Periksa koneksi lalu coba lagi.");
    } finally {
      setBusy(false);
      setPin("");
    }
  }

  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length === 6) void submit(next);
  };

  return (
    <div role="dialog" aria-modal aria-labelledby="judul-kunci" className="fixed inset-0 z-[40] flex flex-col items-center justify-center gap-6 bg-latar px-4">
      <Lock size={28} strokeWidth={1.75} aria-hidden className="text-aksen" />
      <h1 id="judul-kunci" className="text-[24px] font-bold">
        Masukkan PIN
      </h1>
      <div className="flex gap-3" aria-label={`${pin.length} dari 6 angka`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={cx("h-3.5 w-3.5 rounded-full border-2 border-garis-kontrol", i < pin.length && "border-aksen bg-aksen")} />
        ))}
      </div>
      <input
        aria-label="PIN 6 angka"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        className="sr-only"
        value={pin}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 6);
          setPin(v);
          if (v.length === 6) void submit(v);
        }}
      />
      <p aria-live="polite" className="min-h-5 text-center text-[14px] text-galat">
        {msg}
      </p>
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0"].map((d, i) =>
          d ? (
            <button key={i} type="button" onClick={() => press(d)} className="tabular h-16 w-16 rounded-full bg-permukaan text-[22px] font-semibold shadow-e1">
              {d}
            </button>
          ) : (
            <span key={i} />
          ),
        )}
        <button type="button" aria-label="Hapus angka" onClick={() => setPin((p) => p.slice(0, -1))} className="flex h-16 w-16 items-center justify-center rounded-full">
          <Delete size={22} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Locks after `minutes` without interaction, or when the tab returns after being hidden that long.
 * Content is removed from the DOM immediately; the server cookie is cleared in the background. */
export function LockBoundary({ minutes, children }: { minutes: number; children: React.ReactNode }) {
  const [locked, setLocked] = useState(false);
  const last = useRef(0);
  const hiddenAt = useRef<number | null>(null);
  const lastPing = useRef(0);

  useEffect(() => {
    if (locked) return;
    const limit = minutes * 60_000;
    last.current = Date.now();
    const lock = () => {
      setLocked(true);
      void fetch("/api/pin/lock", { method: "POST" }).catch(() => undefined);
    };
    const activity = () => {
      const now = Date.now();
      last.current = now;
      if (now - lastPing.current > 30_000) {
        lastPing.current = now;
        void fetch("/api/pin/touch", { method: "POST" }).catch(() => undefined);
      }
    };
    const vis = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > limit) lock();
    };
    const timer = setInterval(() => {
      if (Date.now() - last.current > limit) lock();
    }, 1_000);
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, activity));
      document.removeEventListener("visibilitychange", vis);
    };
  }, [minutes, locked]);

  return locked ? <LockScreen onUnlocked={() => setLocked(false)} /> : <>{children}</>;
}

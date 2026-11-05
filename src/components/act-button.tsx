"use client";
import { useRouter } from "next/navigation";
import { useRef, useTransition, type ReactNode } from "react";
import { toast } from "./toast";
import { Button, cx } from "./ui";

type Result = { ok: true } | { error: { message: string } };

/** Runs a (bound) Server Action. With `confirm`, a native <dialog> asks first; focus starts on "Batal". */
export function ActButton({
  action, children, variant = "sekunder", confirm, done, undo, className, redirectTo,
}: {
  action: () => Promise<Result>;
  children: ReactNode;
  variant?: "utama" | "sekunder" | "lembut" | "teks" | "bahaya";
  confirm?: { title: string; body?: string; verb: string };
  done?: string;
  undo?: () => Promise<Result>;
  className?: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const dlg = useRef<HTMLDialogElement>(null);

  const run = () =>
    start(async () => {
      dlg.current?.close();
      const r = await action().catch(() => ({ error: { message: "Tidak ada koneksi. Perubahan belum tersimpan." } }));
      if ("error" in r) return toast({ text: r.error.message, tone: "galat" });
      if (done)
        toast({
          text: done,
          action: undo ? { label: "Urungkan", run: () => void undo().then(() => router.refresh()) } : undefined,
        });
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    });

  return (
    <>
      <Button variant={variant} className={className} disabled={pending} onClick={() => (confirm ? dlg.current?.showModal() : run())}>
        {children}
      </Button>
      {confirm && (
        <dialog ref={dlg} aria-labelledby="dlg-judul" className="m-auto w-[min(420px,calc(100%-32px))] rounded-kartu bg-permukaan p-6 shadow-e3">
          <h2 id="dlg-judul" className="text-[18px] font-bold">{confirm.title}</h2>
          {confirm.body && <p className="mt-2 text-[14px] text-teks-redup">{confirm.body}</p>}
          <div className={cx("mt-6 flex justify-end gap-3")}>
            <Button variant="sekunder" autoFocus onClick={() => dlg.current?.close()}>Batal</Button>
            <Button variant="bahaya" onClick={run}>{confirm.verb}</Button>
          </div>
        </dialog>
      )}
    </>
  );
}

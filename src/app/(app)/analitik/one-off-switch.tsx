"use client";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { setOneOff } from "@/app/actions/transactions";
import { toast } from "@/components/toast";
import { cx } from "@/components/ui";

/** "Sekali-jalan" switch for one transaction (F-08.3); flips instantly and rolls back on failure. */
export function OneOffSwitch({ id, value, title }: { id: string; value: boolean; title: string }) {
  const router = useRouter();
  const [on, setOn] = useOptimistic(value);
  const [pending, start] = useTransition();
  const flip = () =>
    start(async () => {
      setOn(!value);
      const r = await setOneOff(id, !value).catch(() => ({ error: { message: "Tidak ada koneksi. Perubahan belum tersimpan." } }));
      if ("error" in r) return toast({ text: r.error.message, tone: "galat" });
      toast({ text: !value ? `${title} ditandai sekali-jalan.` : `${title} kembali dihitung rutin.` });
      router.refresh();
    });
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Sekali-jalan: ${title}`}
      disabled={pending}
      onClick={flip}
      className="group inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-full pr-1 pl-3 text-[13px] font-semibold text-teks-redup hover:text-teks disabled:cursor-wait"
    >
      <span className="hidden sm:inline">Sekali-jalan</span>
      <span className={cx("relative h-6 w-10 rounded-full transition-colors duration-sedang ease-standar", on ? "bg-aksen" : "bg-garis-kontrol/45 group-hover:bg-garis-kontrol/70")}>
        <span
          className={cx(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-permukaan shadow-e1 transition-transform duration-sedang ease-standar",
            on && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

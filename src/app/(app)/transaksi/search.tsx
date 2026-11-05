"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { inputClass } from "@/components/ui";

export function SearchBox() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      const cur = params.get("q") ?? "";
      const next = q.trim().length >= 2 ? q.trim() : "";
      if (next === cur) return;
      const p = new URLSearchParams(params);
      if (next) p.set("q", next);
      else p.delete("q");
      router.replace(`${path}?${p}`, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [q, params, path, router]);
  return (
    <div className="relative">
      <Search size={18} aria-hidden className="absolute top-1/2 left-3 -translate-y-1/2 text-teks-pelan" />
      <label htmlFor="cari" className="sr-only">Cari merchant atau catatan</label>
      <input id="cari" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari merchant atau catatan" className={`${inputClass()} pl-10`} />
      {q.trim().length === 1 && <p className="mt-1 text-[13px] text-teks-pelan" aria-live="polite">Ketik minimal 2 huruf.</p>}
    </div>
  );
}

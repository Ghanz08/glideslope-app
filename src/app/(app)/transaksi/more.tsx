"use client";
import { useEffect, useRef, useState } from "react";
import { TxList, type TxRow } from "@/components/tx-list";
import { Button } from "@/components/ui";

/** Loads the next 50 rows when the end of the list scrolls into view (button as a fallback). */
export function LoadMore({ query, cursor }: { query: string; cursor: string | null }) {
  const [pages, setPages] = useState<TxRow[][]>([]);
  const [next, setNext] = useState(cursor);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  async function load() {
    if (!next || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/transactions?${query}&limit=50&cursor=${next}`);
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { items: TxRow[]; next_cursor: string | null };
      setPages((p) => [...p, body.items]);
      setNext(body.next_cursor);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && void load(), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  });

  return (
    <>
      {pages.map((rows, i) => <TxList key={i} rows={rows} emptyText="" grouped />)}
      {next && (
        <div ref={sentinel} className="flex justify-center p-4">
          <Button variant="sekunder" onClick={() => void load()} disabled={busy}>{busy ? "Memuat…" : failed ? "Coba lagi" : "Muat lagi"}</Button>
        </div>
      )}
    </>
  );
}

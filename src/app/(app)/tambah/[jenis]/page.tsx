import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/server/owner";
import { getAccounts, getCategories, today } from "@/lib/server/queries";
import { EntryForm } from "./entry-form";

export const metadata: Metadata = { title: "Catat transaksi" };

const MODES = ["pengeluaran", "pemasukan", "transfer"] as const;

export default async function CatatPage({
  params, searchParams,
}: { params: Promise<{ jenis: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const { jenis } = await params;
  const mode = MODES.find((m) => m === jenis);
  if (!mode) notFound();
  const q = await searchParams;
  const [accounts, categories, last] = await Promise.all([
    getAccounts(gate.supabase),
    getCategories(gate.supabase, mode === "pemasukan" ? "income" : "expense"),
    gate.supabase.from("transactions").select("account_id").eq("source", "manual").is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const accountIds = new Set(accounts.map((a) => a.id));
  const preferred = [q.akun, last.data?.account_id].find((id) => id && accountIds.has(id));
  return (
    <>
      <h1 className="sr-only">Catat transaksi</h1>
      <EntryForm
        mode={mode}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        categories={categories.filter((c) => c.name !== "Biaya admin" || mode === "pengeluaran").map((c) => ({ id: c.id, name: c.name, icon_key: c.icon_key, tone_key: c.tone_key }))}
        today={today()}
        llmEnabled={gate.settings.llm_enabled}
        defaults={{
          account_id: preferred,
          date: q.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(q.tanggal) ? q.tanggal : undefined,
          merchant: q.merchant?.slice(0, 200),
          amount: q.jumlah && /^\d+$/.test(q.jumlah) ? Number(q.jumlah) : undefined,
          note: q.catatan?.slice(0, 500),
        }}
      />
    </>
  );
}

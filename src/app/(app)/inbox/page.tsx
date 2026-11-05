import type { Metadata } from "next";
import { requireOwner } from "@/lib/server/owner";
import { getInboxItems, type InboxFilter } from "@/lib/server/inbox";
import { getAccounts, getCategories, getLabels, today } from "@/lib/server/queries";
import { ErrorState } from "@/components/ui";
import { addDays, wibStart } from "@/lib/core/dates";
import { InboxView } from "./inbox-view";

export const metadata: Metadata = { title: "Inbox" };

const FILTERS: InboxFilter[] = ["semua", "cocok", "merchant_baru", "belum_terkait"];

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ filter?: string; item?: string }> }) {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f === sp.filter) ?? "semua";
  let items;
  try {
    items = await getInboxItems(gate.supabase);
  } catch {
    return <ErrorState retryHref="/inbox" />;
  }
  const since = wibStart(addDays(today(), -1)).toISOString();
  const [categories, accounts, auto, labels, fresh] = await Promise.all([
    getCategories(gate.supabase),
    getAccounts(gate.supabase, { includeSystem: true }),
    gate.supabase.from("transactions").select("id", { count: "exact", head: true }).eq("status", "auto_confirmed").gte("created_at", since),
    getLabels(gate.supabase),
    gate.supabase.from("transactions").select("id", { count: "exact", head: true }).neq("source", "manual").is("deleted_at", null).gte("created_at", since),
  ]);
  const counts = {
    semua: items.length,
    cocok: items.filter((i) => i.bucket.includes("cocok")).length,
    merchant_baru: items.filter((i) => i.bucket.includes("merchant_baru")).length,
    belum_terkait: items.filter((i) => i.bucket.includes("belum_terkait")).length,
  };
  const shown = filter === "semua" ? items : items.filter((i) => i.bucket.includes(filter));
  return (
    <InboxView
      items={shown}
      categories={categories.map((c) => ({ id: c.id, name: c.name, icon_key: c.icon_key, tone_key: c.tone_key, kind: c.kind }))}
      accounts={accounts.map((a) => ({ id: a.id, name: a.name, is_system: a.is_system }))}
      labels={labels}
      filter={filter}
      counts={counts}
      autoCount={auto.count ?? 0}
      newCount={fresh.count ?? 0}
      focusKey={sp.item}
    />
  );
}

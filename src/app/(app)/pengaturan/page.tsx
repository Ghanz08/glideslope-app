import type { Metadata } from "next";
import { vapidPublicKey } from "@/lib/env";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireOwner } from "@/lib/server/owner";
import { signOutAction } from "@/app/masuk/actions";
import { Card, PageTitle, buttonClass } from "@/components/ui";
import { GeneralForm, PinForm } from "./general-form";
import { Categories, Merchants } from "./catalog";
import { DataSection } from "./data-section";
import { PushSection } from "./push-section";
import { Banners } from "@/components/banners";
import { getBanners } from "@/lib/server/home";
import { getAssets, today } from "@/lib/server/queries";
import { getCategories } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Pengaturan" };

export default async function PengaturanPage() {
  const gate = await requireOwner();
  if (gate.state !== "ok") return null;
  const s = gate.settings;
  const [cats, used, merchants] = await Promise.all([
    getCategories(gate.supabase, undefined, true),
    gate.supabase.from("transactions").select("category_id").not("category_id", "is", null),
    gate.supabase.from("merchants").select("id, display_name, default_category_id, default_one_off, skip_review").order("display_name").limit(200),
  ]);
  const banners = await getBanners(gate.supabase, s, await getAssets(gate.supabase), today());
  const usage = new Map<string, number>();
  for (const r of used.data ?? []) usage.set(r.category_id, (usage.get(r.category_id) ?? 0) + 1);
  const links = [
    { href: "/akun", label: "Rekening & wallet" },
    { href: "/sumber", label: "Sumber email" },
    { href: "/langganan", label: "Langganan" },
    { href: "/rencana", label: "Rencana pengeluaran" },
    { href: "/label", label: "Label" },
    { href: "/piutang", label: "Piutang" },
    { href: "/analitik", label: "Analitik" },
  ];
  return (
    <>
      <PageTitle title="Pengaturan" />
      <Banners items={banners} max={5} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <h2 className="mb-4 text-[16px] font-bold">Umum</h2>
            <GeneralForm s={s} />
          </Card>
          <Card>
            <h2 className="mb-4 text-[16px] font-bold">Kategori</h2>
            <Categories cats={cats.map((c) => ({ ...c, used: usage.get(c.id) ?? 0 }))} />
          </Card>
          <Card>
            <h2 className="mb-4 text-[16px] font-bold">Aturan merchant</h2>
            <Merchants merchants={merchants.data ?? []} cats={cats.filter((c) => c.kind === "expense" && !c.archived_at).map((c) => ({ id: c.id, name: c.name }))} />
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <h2 className="mb-4 text-[16px] font-bold">Keamanan</h2>
            <PinForm enabled={s.pin_enabled} />
            <form action={signOutAction} className="mt-4">
              <button type="submit" className={buttonClass("sekunder", true)}>Keluar</button>
            </form>
          </Card>
          <Card>
            <h2 className="mb-4 text-[16px] font-bold">Notifikasi</h2>
            <PushSection prefs={s.push_prefs} vapidKey={vapidPublicKey()} />
          </Card>
          <Card>
            <h2 className="mb-4 text-[16px] font-bold">Data milikmu</h2>
            <DataSection pinEnabled={s.pin_enabled} lastExport={s.last_export_at} />
          </Card>
          <Card className="p-0 lg:hidden">
            <ul>
              {links.map((l) => (
                <li key={l.href} className="border-b border-garis last:border-0">
                  <Link href={l.href} className="flex min-h-12 items-center justify-between px-5">{l.label}<ChevronRight size={18} aria-hidden /></Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

import "server-only";
import type { Supa } from "./supabase";
import type { Settings } from "./owner";
import { addDays, formatDate, now, type ISODate } from "@/lib/core/dates";
import type { AssetRow } from "./queries";

export interface BannerItem {
  key: "gmail" | "deposito" | "harga" | "ekspor" | "checkpoint";
  tone: "info" | "perhatian";
  text: string;
  href: string;
  cta: string;
}

const ORDER: BannerItem["key"][] = ["gmail", "deposito", "harga", "ekspor", "checkpoint"];

/** F-06.4 / F-13.2 / F-11.1 banners, priority-ordered, minus the ones dismissed in the last 7 days. */
export async function getBanners(s: Supa, settings: Settings, assets: AssetRow[], today: ISODate): Promise<BannerItem[]> {
  const out: BannerItem[] = [];
  const integ = await s.from("integrations").select("status").eq("provider", "gmail").maybeSingle();
  if (integ.data?.status === "perlu_hubungkan_ulang")
    out.push({ key: "gmail", tone: "perhatian", text: "Gmail perlu dihubungkan ulang. Transaksi email berhenti masuk sampai kamu menghubungkannya lagi.", href: "/sumber", cta: "Hubungkan ulang" });
  const soon = assets
    .filter((a) => a.type === "deposit" && a.maturity_date && a.maturity_date <= addDays(today, 7))
    .sort((a, b) => a.maturity_date!.localeCompare(b.maturity_date!))[0];
  if (soon)
    out.push({
      key: "deposito",
      tone: "info",
      text: soon.maturity_date! < today ? `${soon.name} lewat jatuh tempo ${formatDate(soon.maturity_date!)}` : `${soon.name} jatuh tempo ${formatDate(soon.maturity_date!)}`,
      href: `/aset/${soon.id}`,
      cta: "Lihat",
    });
  const stale = assets.filter((a) => a.stale);
  if (stale.length) out.push({ key: "harga", tone: "info", text: `Harga ${stale.map((a) => a.name).join(", ")} belum diperbarui lebih dari 14 hari.`, href: `/aset/${stale[0].id}`, cta: "Perbarui harga" });
  if (!settings.last_export_at || now().getTime() - Date.parse(settings.last_export_at) > 7 * 86400_000)
    out.push({
      key: "ekspor",
      tone: "info",
      text: settings.last_export_at ? "Data belum dicadangkan lebih dari 7 hari." : "Data belum dicadangkan lebih dari 7 hari. Belum pernah dicadangkan.",
      href: "/pengaturan#ekspor",
      cta: "Ekspor data",
    });
  if (today.endsWith("-01"))
    out.push({ key: "checkpoint", tone: "info", text: "Awal bulan: cocokkan saldo akun yang bersumber email dengan aplikasi bank.", href: "/akun", cta: "Isi titik cek" });

  const t = now().getTime();
  return out
    .filter((b) => !settings.dismissed_banners[b.key] || Date.parse(settings.dismissed_banners[b.key]) < t)
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
}

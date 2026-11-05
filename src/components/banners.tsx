import Link from "next/link";
import { X } from "lucide-react";
import { dismissBanner } from "@/app/actions/settings";
import type { BannerItem } from "@/lib/server/home";
import { ActButton } from "./act-button";
import { Banner } from "./ui";

export function Banners({ items, max = 2 }: { items: BannerItem[]; max?: number }) {
  if (!items.length) return null;
  return (
    <div className="mb-4 flex flex-col gap-2">
      {items.slice(0, max).map((b) => (
        <Banner
          key={b.key}
          tone={b.tone}
          action={
            <ActButton variant="teks" action={dismissBanner.bind(null, b.key)} className="!min-h-8 !px-2">
              <X size={16} aria-label="Tutup pemberitahuan" />
            </ActButton>
          }
        >
          {b.text}{" "}
          <Link href={b.href} className="font-semibold underline">{b.cta}</Link>
        </Banner>
      ))}
    </div>
  );
}

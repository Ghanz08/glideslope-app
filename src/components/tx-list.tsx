import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { formatDate, formatDayMonth, wibDate } from "@/lib/core/dates";
import { formatRupiah } from "@/lib/core/money";
import { displayName } from "@/lib/core/domain";
import { CategoryChip, CategoryTile, EmptyState, TxAmount } from "./ui";

export const txSelect =
  "id, occurred_at, amount, direction, kind, status, merchant_raw, note, is_one_off, source, review_reason, updated_at, account_id, category_id, merchant_id, deleted_at, created_at, " +
  "accounts(name), categories(name, icon_key, tone_key), merchants(display_name), transaction_evidence(role), transaction_labels(labels(id, name))";

export interface TxRow {
  id: string;
  occurred_at: string;
  amount: number;
  direction: "in" | "out";
  kind: string;
  status: string;
  merchant_raw: string | null;
  note: string | null;
  is_one_off: boolean;
  source: string;
  review_reason: string | null;
  updated_at: string;
  account_id: string;
  category_id: string | null;
  merchant_id: string | null;
  accounts: { name: string } | null;
  categories: { name: string; icon_key: string; tone_key: string } | null;
  merchants: { display_name: string } | null;
  transaction_evidence: { role: string }[];
  transaction_labels?: { labels: { id: string; name: string } | null }[];
  deleted_at?: string | null;
}

export const txLabels = (t: TxRow) => (t.transaction_labels ?? []).flatMap((l) => (l.labels ? [l.labels] : []));

/** F-08.4: small "# Umroh 2026" chips; meaning is in the text, not the colour. */
export function LabelChips({ t }: { t: TxRow }) {
  const ls = txLabels(t);
  if (!ls.length) return null;
  return (
    <span className="inline-flex shrink-0 gap-1">
      {ls.map((l) => (
        <span key={l.id} className="inline-flex items-center rounded-full bg-aksen-lembut px-2 text-[12px] leading-5 font-semibold whitespace-nowrap text-aksen">
          <span aria-hidden className="mr-0.5 opacity-60">#</span>{l.name}
        </span>
      ))}
    </span>
  );
}

const KIND_TITLE: Record<string, string> = {
  transfer: "Transfer",
  fee: "Biaya admin",
  redemption: "Pencairan aset",
  investment: "Beli aset",
  repayment: "Pelunasan piutang",
};

export const txTitle = (t: TxRow) => displayName(t.merchants?.display_name ?? t.merchant_raw ?? KIND_TITLE[t.kind] ?? (t.direction === "in" ? "Pemasukan" : "Pengeluaran"));

export function txCategory(t: TxRow) {
  if (t.categories) return t.categories;
  if (t.kind === "transfer") return { name: "Transfer", icon_key: "transfer", tone_key: "netral" };
  if (t.kind === "repayment") return { name: "Piutang", icon_key: "transfer", tone_key: "piutang" };
  if (t.kind === "redemption" || t.kind === "investment") return { name: "Aset", icon_key: "landmark", tone_key: "netral" };
  return { name: "Tanpa kategori", icon_key: "circle-ellipsis", tone_key: "netral" };
}

const ROLE_LABEL: Record<string, string> = { email: "email", receipt: "nota", webhook: "notifikasi HP", manual: "catatan" };

export function Verified({ t }: { t: TxRow }) {
  if ((t.transaction_evidence?.length ?? 0) < 2) return null;
  const order = Object.keys(ROLE_LABEL);
  const roles = [...new Set([...t.transaction_evidence].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)).map((e) => ROLE_LABEL[e.role] ?? e.role))];
  const label = `Terverifikasi dari ${roles.length > 1 ? roles.join(" dan ") : `${t.transaction_evidence.length} ${roles[0]}`}`;
  return (
    <span title={label} role="img" aria-label={label} className="inline-flex text-aksen">
      <CircleCheck size={16} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

function StatusTag({ t }: { t: TxRow }) {
  if (t.status === "needs_review") return <span className="shrink-0 text-[12px] font-semibold whitespace-nowrap text-peringatan">Perlu dicek</span>;
  if (t.status === "ignored") return <span className="text-[12px] text-teks-pelan">Diabaikan</span>;
  if (t.kind === "transfer") return <span className="text-[12px] text-teks-pelan">Transfer</span>;
  return null;
}

export function TxList({ rows, emptyText, grouped = false, compactCount }: { rows: TxRow[]; emptyText: string; grouped?: boolean; compactCount?: number }) {
  if (!rows.length) return <EmptyState title={emptyText} />;
  const groups = new Map<string, TxRow[]>();
  for (const r of rows) {
    const k = grouped ? wibDate(r.occurred_at) : "all";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <div>
      {/* mobile list */}
      <div className="lg:hidden">
        {[...groups].map(([day, list]) => (
          <section key={day} aria-label={grouped ? formatDate(day) : undefined}>
            {grouped && (
              <h3 className="flex justify-between bg-latar px-5 py-2 text-[13px] font-semibold text-teks-redup">
                <span>{formatDate(day)}</span>
                <span className="tabular">
                  −{formatRupiah(list.filter((t) => t.status !== "ignored" && (t.kind === "expense" || t.kind === "fee")).reduce((a, t) => a + t.amount, 0))}
                </span>
              </h3>
            )}
            <ul>
              {list.slice(0, compactCount ?? list.length).map((t) => {
                const c = txCategory(t);
                return (
                  <li key={t.id}>
                    <Link href={`/transaksi/${t.id}`} className="flex min-h-[64px] items-center gap-3 px-5 py-2.5">
                      <CategoryTile icon={c.icon_key} tone={c.tone_key} size={40} name={txTitle(t)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[15px] font-semibold"><span className="truncate">{txTitle(t)}</span> <Verified t={t} /> <LabelChips t={t} /></span>
                        <span className="flex gap-2 text-[13px] text-teks-redup">
                          <StatusTag t={t} />
                          <span className="truncate">{c.name} · {t.accounts?.name}</span>
                        </span>
                        {t.note && <span className="block truncate text-[13px] text-teks-pelan italic">{t.note}</span>}
                      </span>
                      <TxAmount amount={t.amount} direction={t.direction} kind={t.kind} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {/* desktop table */}
      <table className="hidden w-full text-left lg:table">
        <thead>
          <tr className="border-b border-garis text-[13px] text-teks-pelan">
            <th scope="col" className="px-5 py-3 font-medium">Tanggal</th>
            <th scope="col" className="py-3 font-medium">Merchant</th>
            <th scope="col" className="py-3 font-medium">Kategori</th>
            <th scope="col" className="py-3 font-medium">Akun</th>
            <th scope="col" className="px-5 py-3 text-right font-medium">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, compactCount ?? rows.length).map((t) => {
            const c = txCategory(t);
            return (
              <tr key={t.id} className="h-16 border-b border-garis last:border-0 hover:bg-latar">
                <td className="tabular px-5 text-[14px] text-teks-redup">{formatDayMonth(t.occurred_at)}</td>
                <td>
                  <Link href={`/transaksi/${t.id}`} className="flex items-center gap-3 font-semibold">
                    <CategoryTile icon={c.icon_key} tone={c.tone_key} size={36} name={txTitle(t)} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2"><span className="truncate">{txTitle(t)}</span><StatusTag t={t} /><LabelChips t={t} /></span>
                      {t.note && <span className="block max-w-[360px] truncate text-[13px] font-normal text-teks-pelan italic">{t.note}</span>}
                    </span>
                  </Link>
                </td>
                <td><CategoryChip name={c.name} icon={c.icon_key} tone={c.tone_key} /></td>
                <td className="text-[14px] text-teks-redup">{t.accounts?.name}</td>
                <td className="px-5 text-right">
                  <span className="inline-flex items-center gap-2"><Verified t={t} /><TxAmount amount={t.amount} direction={t.direction} kind={t.kind} /></span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

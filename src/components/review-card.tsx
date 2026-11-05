import Link from "next/link";
import { getInboxItems, itemCategory } from "@/lib/server/inbox";
import { createClient } from "@/lib/server/supabase";
import { confirmReview } from "@/app/actions/review";
import { ActButton } from "./act-button";
import { Badge, ButtonLink, Card, CategoryTile, TxAmount } from "./ui";
import { txTitle } from "./tx-list";

/** S-04 "Perlu dicek": the newest open item with Lewati / Konfirmasi and a link to the Inbox. */
export async function ReviewCard({ count, autoCount }: { count: number; autoCount: number }) {
  const items = await getInboxItems(await createClient());
  const [first, second] = items;
  if (!first) return null;
  const c = itemCategory(first);
  const canConfirm = !first.proposals.length && (!!first.tx.category_id || !["expense", "income", "fee"].includes(first.tx.kind)) && first.tx.review_reason !== "akun_tidak_dikenal";
  return (
    <Card>
      <h2 className="mb-4 flex items-center gap-2 text-[17px] font-bold">Perlu dicek <Badge n={count} label={`${count} item perlu dicek`} /></h2>
      <div className="flex items-center gap-3">
        <CategoryTile icon={c.icon_key} tone={c.tone_key} size={44} name={txTitle(first.tx)} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{first.title}</p>
          <p className="truncate text-[13px] text-teks-redup">{first.subtitle}</p>
        </div>
        <TxAmount amount={Number(first.tx.amount)} direction={first.tx.direction} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <ButtonLink href={`/inbox?item=${second?.key ?? first.key}`} variant="sekunder">Lewati</ButtonLink>
        {canConfirm ? (
          <ActButton variant="lembut" action={confirmReview.bind(null, { transaction_id: first.tx.id, category_id: first.tx.category_id, remember: true })} done="Dikonfirmasi.">Konfirmasi</ActButton>
        ) : (
          <ButtonLink href={`/inbox?item=${first.key}`} variant="lembut">Konfirmasi</ButtonLink>
        )}
      </div>
      {second && (
        <Link href={`/inbox?item=${second.key}`} className="mt-4 flex items-center gap-3 border-t border-garis pt-4">
          <CategoryTile icon={itemCategory(second).icon_key} tone={itemCategory(second).tone_key} size={40} name={txTitle(second.tx)} />
          <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{second.title}</span><span className="text-[13px] text-teks-redup">{second.subtitle}</span></span>
          <TxAmount amount={Number(second.tx.amount)} direction={second.tx.direction} />
        </Link>
      )}
      <ButtonLink href="/inbox" full className="mt-4">Buka Inbox</ButtonLink>
      <p className="mt-4 text-[13px] text-teks-redup">
        {autoCount} transaksi masuk otomatis sejak kemarin <Link href="/transaksi?status=auto_confirmed" className="font-semibold text-aksen">Lihat</Link>
      </p>
    </Card>
  );
}

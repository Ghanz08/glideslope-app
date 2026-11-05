import { labelSummary } from "@/lib/core/insights";

type Row = { amount: number; kind: string; status: string; deleted_at: string | null };
export type LabelWithTx = {
  id: string; name: string; auto_one_off: boolean; target_amount: number | null; archived_at: string | null;
  transaction_labels: { transactions: Row | null }[];
};

export const summarize = (l: LabelWithTx) =>
  labelSummary(l.transaction_labels.flatMap((x) => (x.transactions ? [x.transactions] : [])), l.target_amount == null ? null : Number(l.target_amount));

/** Progress toward a label's target; the numbers are always written out, the bar only repeats them. */
export function TargetBar({ pct }: { pct: number }) {
  return (
    <span aria-hidden className="block h-2 overflow-hidden rounded-full bg-isian">
      <span className="block h-full rounded-full bg-aksen" style={{ width: `${Math.max(pct, 2)}%` }} />
    </span>
  );
}

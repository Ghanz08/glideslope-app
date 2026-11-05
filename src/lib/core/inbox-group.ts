// F-04.6: open items of the same new merchant fold into one Inbox card ("12 transaksi").
export function foldNewMerchants<T extends { merchantId: string | null; reason: string | null; hasProposal: boolean }>(
  items: T[],
): (T & { groupCount: number; groupIndexes: number[] })[] {
  const out: (T & { groupCount: number; groupIndexes: number[] })[] = [];
  const byMerchant = new Map<string, T & { groupCount: number; groupIndexes: number[] }>();
  items.forEach((it, i) => {
    if (it.merchantId && it.reason === "merchant_baru" && !it.hasProposal) {
      const g = byMerchant.get(it.merchantId);
      if (g) {
        g.groupCount++;
        g.groupIndexes.push(i);
        return;
      }
      const head = { ...it, groupCount: 1, groupIndexes: [i] };
      byMerchant.set(it.merchantId, head);
      out.push(head);
      return;
    }
    out.push({ ...it, groupCount: 1, groupIndexes: [i] });
  });
  return out;
}

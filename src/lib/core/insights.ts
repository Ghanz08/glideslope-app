// Quick-add parsing (F-12.4), subscription detection (F-11.2), net change (5.4-G), liquidity ladder (F-07.2).
import { addDays, daysBetween, type ISODate } from "./dates";
import { percentages } from "./domain";

// ---------------------------------------------------------------- F-12.4
const SUFFIX: Record<string, number> = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6 };

export interface QuickAddResult {
  amount: number | null;
  merchant: string | null;
  account: string | null;
  candidates: number[]; // set when several plain numbers make the amount ambiguous
}

export function parseQuickAdd(text: string, accountNames: string[]): QuickAddResult {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const withUnit: { i: number; v: number }[] = [];
  const plain: { i: number; v: number }[] = [];
  tokens.forEach((t, i) => {
    const m = t.toLowerCase().match(/^(?:rp\.?)?(\d+(?:[.,]\d+)?)(rb|ribu|k|jt|juta)?$/);
    if (!m) return;
    const num = Number(m[1].replace(",", "."));
    if (m[2]) withUnit.push({ i, v: Math.round(num * SUFFIX[m[2]]) });
    else plain.push({ i, v: Number(m[1].replace(/[.,]/g, "")) });
  });
  const lower = accountNames.map((a) => a.toLowerCase());
  let account: string | null = null;
  const used = new Set<number>();
  tokens.forEach((t, i) => {
    const k = lower.indexOf(t.toLowerCase());
    if (k >= 0 && !account) {
      account = accountNames[k];
      used.add(i);
    }
  });
  let amount: number | null = null;
  let candidates: number[] = [];
  if (withUnit.length) {
    amount = withUnit[0].v;
    used.add(withUnit[0].i);
  } else if (plain.length === 1) {
    amount = plain[0].v;
    used.add(plain[0].i);
  } else if (plain.length > 1) {
    candidates = plain.map((p) => p.v);
    plain.forEach((p) => used.add(p.i));
  }
  const merchant = tokens.filter((_, i) => !used.has(i)).join(" ") || null;
  return { amount: amount && amount > 0 ? amount : null, merchant, account, candidates };
}

// ---------------------------------------------------------------- F-11.2
export interface SubSuggestion {
  period: "monthly" | "yearly";
  avg_amount: number;
  last_seen_on: ISODate;
  next_expected_on: ISODate;
}

/** Looks at the latest run of ≥3 transactions with regular gaps and amounts within ±10% of their mean. */
export function detectSubscription(txs: { date: ISODate; amount: number }[]): SubSuggestion | null {
  const s = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  for (const [period, lo, hi] of [["monthly", 28, 35], ["yearly", 360, 370]] as const) {
    let run = [s[s.length - 1]];
    for (let i = s.length - 2; i >= 0; i--) {
      const gap = daysBetween(s[i].date, run[0].date);
      if (gap < lo || gap > hi) break;
      const cand = [s[i], ...run];
      const avg = cand.reduce((a, t) => a + t.amount, 0) / cand.length;
      if (cand.some((t) => Math.abs(t.amount - avg) > avg * 0.1)) break;
      run = cand;
    }
    if (run.length >= 3) {
      const avg = Math.round(run.reduce((a, t) => a + t.amount, 0) / run.length);
      const gaps = run.slice(1).map((t, i) => daysBetween(run[i].date, t.date));
      const meanGap = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      const last = run[run.length - 1].date;
      return { period, avg_amount: avg, last_seen_on: last, next_expected_on: addDays(last, meanGap) };
    }
  }
  return null;
}

// ---------------------------------------------------------------- Table 5.4-G
export function marketChange(a: { valueNow: number; valueMonthStart: number | null; purchases: number; redemptions: number }): number {
  if (a.valueMonthStart == null) return 0;
  return a.valueNow - a.valueMonthStart - (a.purchases - a.redemptions);
}

// ---------------------------------------------------------------- F-07.2 liquidity ladder
export type AssetType = "deposit" | "money_market_fund" | "fixed_income_fund" | "equity_fund" | "bond" | "stock" | "gold" | "crypto" | "other";

/** Ordered from fastest to slowest / least predictable cash-out (F-07.2). */
export const LADDER: { key: "cash" | AssetType; label: string; speed: string; volatile: boolean }[] = [
  { key: "cash", label: "Rekening & wallet", speed: "Langsung", volatile: false },
  { key: "money_market_fund", label: "Reksa dana pasar uang", speed: "1–3 hari kerja", volatile: false },
  { key: "fixed_income_fund", label: "Reksa dana pendapatan tetap", speed: "2–7 hari kerja", volatile: true },
  { key: "deposit", label: "Deposito", speed: "Jatuh tempo bertahap", volatile: false },
  { key: "bond", label: "Obligasi & SBN", speed: "Jual ±2 hari kerja atau tunggu jatuh tempo", volatile: false },
  { key: "gold", label: "Emas", speed: "Harga berfluktuasi", volatile: true },
  { key: "equity_fund", label: "Reksa dana saham & campuran", speed: "Harga berfluktuasi", volatile: true },
  { key: "stock", label: "Saham", speed: "Harga berfluktuasi · cair T+2", volatile: true },
  { key: "crypto", label: "Kripto", speed: "Harga sangat berfluktuasi", volatile: true },
  { key: "other", label: "Lainnya", speed: "Tergantung jenis", volatile: false },
];

/** Asset types whose price is entered by the owner and goes stale after 14 days. */
export const VOLATILE_TYPES: AssetType[] = ["money_market_fund", "fixed_income_fund", "equity_fund", "stock", "gold", "crypto"];
/** Types held as one unit priced at the principal (pokok). */
export const PRINCIPAL_TYPES: AssetType[] = ["deposit", "bond"];

/** Net monthly coupon of a bond: principal × rate / 12, minus the final tax (10% on bond interest for residents, PP 91/2021). */
export function monthlyCoupon(principal: number, ratePa: number, taxPct = 10): number {
  return Math.round(((principal * ratePa) / 100 / 12) * (1 - taxPct / 100));
}

export function ladderRows(values: Partial<Record<"cash" | AssetType, number>>) {
  const rows = LADDER.filter((r) => r.key === "cash" || (values[r.key] ?? 0) > 0).map((r) => ({ ...r, value: values[r.key] ?? 0 }));
  const total = rows.reduce((a, r) => a + r.value, 0);
  const pcts = total > 0 ? percentages(rows.map((r) => r.value)) : rows.map(() => null);
  return { total, rows: rows.map((r, i) => ({ ...r, pct: pcts[i] })) };
}

// ---------------------------------------------------------------- F-08.2 category breakdown
export function categoryBreakdown(rows: { category_id: string | null; effective: number }[]) {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.category_id ?? "tanpa", (by.get(r.category_id ?? "tanpa") ?? 0) + r.effective);
  const list = [...by].map(([category_id, amount]) => ({ category_id, amount })).filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
  const pcts = percentages(list.map((x) => x.amount));
  return list.map((x, i) => ({ ...x, share_pct: pcts[i] }));
}

/** "−Rp 300.000 (−3,6%)"; percent is null when last month was 0. */
export function monthDelta(current: number, previous: number): { diff: number; pct: number | null } {
  return { diff: current - previous, pct: previous ? Math.round(((current - previous) / previous) * 1000) / 10 : null };
}

/** F-08.4: spending under a label (expense + fee, not ignored or deleted) against its optional target. */
export function labelSummary(
  rows: { amount: number; kind: string; status: string; deleted_at?: string | null }[],
  target: number | null,
): { spent: number; count: number; remaining: number | null; pct: number | null } {
  const used = rows.filter((r) => (r.kind === "expense" || r.kind === "fee") && r.status !== "ignored" && !r.deleted_at);
  const spent = used.reduce((a, r) => a + Number(r.amount), 0);
  return {
    spent,
    count: used.length,
    remaining: target ? Math.max(0, target - spent) : null,
    pct: target ? Math.min(100, Math.round((spent / target) * 1000) / 10) : null,
  };
}

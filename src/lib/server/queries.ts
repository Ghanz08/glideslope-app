import "server-only";
import type { Supa } from "./supabase";
import type { Settings } from "./owner";
import { addMonths, daysBetween, monthStart, now, todayWib, wibDate, wibStart, type ISODate } from "@/lib/core/dates";
import { balanceLabel, type BalanceLabel } from "@/lib/core/domain";
import { computeBurn, computeRunway, expandPlanned, type PlannedExpense } from "@/lib/core/runway";
import { marketChange, VOLATILE_TYPES, type AssetType } from "@/lib/core/insights";
import { effectiveAmount } from "@/lib/core/split";

export const today = () => todayWib(now());
const n = (v: unknown) => (v == null ? 0 : Number(v));

export { inboxCount } from "./inbox";

// ---------------------------------------------------------------- accounts
export interface AccountRow {
  id: string;
  name: string;
  kind: "bank" | "ewallet" | "cash";
  last4: string | null;
  number: string | null; // full account / phone number, shown only when unhidden
  sort_order: number;
  is_system: boolean;
  archived: boolean;
  balance: number;
  label: BalanceLabel;
  checkpoint: { as_of: string; balance: number; computed: number } | null;
}

export async function getAccounts(s: Supa, opts: { includeArchived?: boolean; includeSystem?: boolean } = {}): Promise<AccountRow[]> {
  const t = today();
  const [{ data, error }, nums] = await Promise.all([
    s.rpc("rpc_account_balances", { p_as_of: t }),
    s.from("accounts").select("id, number").not("number", "is", null),
  ]);
  if (error) throw error;
  const numberOf = new Map((nums.data ?? []).map((x) => [x.id as string, x.number as string]));
  return (data as Record<string, unknown>[])
    .map((r) => {
      const checkpoint = r.checkpoint_as_of
        ? { as_of: String(r.checkpoint_as_of), balance: n(r.checkpoint_balance), computed: n(r.checkpoint_computed) }
        : null;
      return {
        id: String(r.account_id),
        name: String(r.name),
        kind: r.kind as AccountRow["kind"],
        last4: (r.last4 as string) ?? null,
        number: numberOf.get(String(r.account_id)) ?? null,
        sort_order: n(r.sort_order),
        is_system: !!r.is_system,
        archived: !!r.archived_at,
        balance: n(r.balance),
        checkpoint,
        label: balanceLabel({ today: t, checkpoint, hasAutoSource30d: !!r.has_auto_source_30d }),
      };
    })
    .filter((a) => (opts.includeSystem || !a.is_system) && (opts.includeArchived || !a.archived));
}

export async function getCategories(s: Supa, kind?: "expense" | "income", includeArchived = false) {
  let q = s.from("categories").select("id, name, kind, icon_key, tone_key, is_system, sort_order, archived_at").order("sort_order");
  if (kind) q = q.eq("kind", kind);
  if (!includeArchived) q = q.is("archived_at", null);
  const { data } = await q;
  return (data ?? []) as { id: string; name: string; kind: string; icon_key: string; tone_key: string; is_system: boolean; archived_at: string | null }[];
}

export interface Label { id: string; name: string; auto_one_off: boolean; target_amount: number | null; archived_at: string | null }

/** F-08.4 labels, active ones first then by name. */
export async function getLabels(s: Supa, includeArchived = false): Promise<Label[]> {
  let q = s.from("labels").select("id, name, auto_one_off, target_amount, archived_at").order("name");
  if (!includeArchived) q = q.is("archived_at", null);
  const { data } = await q;
  return (data ?? []).map((l) => ({ ...l, target_amount: l.target_amount == null ? null : Number(l.target_amount) })) as Label[];
}

// ---------------------------------------------------------------- assets
export interface AssetRow {
  id: string;
  name: string;
  type: AssetType;
  quantity: number;
  maturity_date: string | null;
  interest_rate_pa: number | null;
  coupon_day: number | null;
  destination_account_id: string | null;
  value: number;
  price: number | null;
  price_as_of: string | null;
  stale: boolean;
  valueMonthStart: number | null;
  purchases: number;
  redemptions: number;
  market: number;
}

export async function getAssets(s: Supa, t: ISODate = today(), includeArchived = false): Promise<AssetRow[]> {
  let q = s.from("assets").select("id, name, type, quantity, maturity_date, interest_rate_pa, coupon_day, destination_account_id, archived_at, asset_prices(as_of, unit_price), asset_events(kind, occurred_on, amount, quantity_delta)").order("created_at");
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw error;
  const ms = monthStart(t);
  return (data ?? []).map((a: Record<string, unknown>) => {
    const prices = ((a.asset_prices as { as_of: string; unit_price: string }[]) ?? []).sort((x, y) => y.as_of.localeCompare(x.as_of));
    const events = (a.asset_events as { kind: string; occurred_on: string; amount: number; quantity_delta: string }[]) ?? [];
    const qty = Number(a.quantity);
    const cur = prices.find((p) => p.as_of <= t);
    const value = cur ? Math.round(qty * Number(cur.unit_price)) : 0;
    // value at end of last month: quantity then × latest price on or before that day
    const inMonth = events.filter((e) => e.occurred_on >= ms && e.occurred_on <= t);
    const qtyStart = qty - inMonth.reduce((x, e) => x + Number(e.quantity_delta), 0);
    const startPrice = prices.find((p) => p.as_of < ms);
    const valueMonthStart = startPrice ? Math.round(qtyStart * Number(startPrice.unit_price)) : null;
    const purchases = inMonth.filter((e) => e.kind === "purchase").reduce((x, e) => x + n(e.amount), 0);
    const redemptions = inMonth.filter((e) => e.kind === "redemption").reduce((x, e) => x + n(e.amount), 0);
    const volatile = VOLATILE_TYPES.includes(a.type as AssetType);
    return {
      id: String(a.id),
      name: String(a.name),
      type: a.type as AssetRow["type"],
      quantity: qty,
      maturity_date: (a.maturity_date as string) ?? null,
      interest_rate_pa: a.interest_rate_pa == null ? null : Number(a.interest_rate_pa),
      coupon_day: a.coupon_day == null ? null : Number(a.coupon_day),
      destination_account_id: (a.destination_account_id as string) ?? null,
      value,
      price: cur ? Number(cur.unit_price) : null,
      price_as_of: cur?.as_of ?? null,
      stale: volatile && (!cur || daysBetween(cur.as_of, t) > 14),
      valueMonthStart,
      purchases,
      redemptions,
      market: a.type === "deposit" ? 0 : marketChange({ valueNow: value, valueMonthStart, purchases, redemptions }),
    };
  });
}

// ---------------------------------------------------------------- spending (effective, Table 5.4-D)
export interface SpendTx {
  id: string;
  occurred_at: string;
  amount: number;
  effective: number;
  kind: string;
  is_one_off: boolean;
  category_id: string | null;
}

/** expense + fee rows (not ignored, not deleted) since `from`, with the effective amount after split shares. */
export async function getSpend(s: Supa, from: ISODate): Promise<SpendTx[]> {
  const { data, error } = await s
    .from("transactions")
    .select("id, occurred_at, amount, kind, is_one_off, category_id, split_bills(status, split_participants(is_owner, share_amount))")
    .in("kind", ["expense", "fee"])
    .neq("status", "ignored")
    .is("deleted_at", null)
    .gte("occurred_at", wibStart(from).toISOString())
    .order("occurred_at");
  if (error) throw error;
  return (data ?? []).map((t: Record<string, unknown>) => {
    // split_bills.transaction_id is unique, so PostgREST embeds one object (or null), not an array
    type Split = { status: string; split_participants: { is_owner: boolean; share_amount: number }[] };
    const splits = ([] as Split[]).concat((t.split_bills as Split | Split[] | null) ?? []).map((b) => ({
      status: b.status,
      participants: b.split_participants,
    }));
    return {
      id: String(t.id),
      occurred_at: String(t.occurred_at),
      amount: n(t.amount),
      effective: effectiveAmount(n(t.amount), splits),
      kind: String(t.kind),
      is_one_off: !!t.is_one_off,
      category_id: (t.category_id as string) ?? null,
    };
  });
}

export async function dataStart(s: Supa): Promise<ISODate | null> {
  const { data } = await s
    .from("transactions")
    .select("occurred_at")
    .in("kind", ["expense", "fee"])
    .is("deleted_at", null)
    .order("occurred_at")
    .limit(1)
    .maybeSingle();
  return data ? wibDate(data.occurred_at) : null;
}

export async function getPlanned(s: Supa) {
  const { data } = await s.from("planned_expenses").select("id, label, amount, due_on, repeat_months, repeat_until, paid_occurrences, category_id").order("due_on");
  return ((data ?? []) as (PlannedExpense & { id: string; category_id: string | null })[]).map((p) => ({ ...p, amount: n(p.amount) }));
}

// ---------------------------------------------------------------- runway (API-22 equivalent, Table 5.4-C)
export async function getRunway(s: Supa, settings: Settings) {
  const t = today();
  const [accounts, assets, planned, start, spend] = await Promise.all([
    getAccounts(s),
    getAssets(s, t),
    getPlanned(s),
    dataStart(s),
    getSpend(s, addMonths(monthStart(t), -4)),
  ]);
  const cash = accounts.reduce((a, x) => a + x.balance, 0);
  const assetTotal = assets.reduce((a, x) => a + x.value, 0);
  const routine = spend.filter((x) => !x.is_one_off).map((x) => ({ date: wibDate(x.occurred_at), amount: x.effective }));
  const burn = computeBurn(routine, start, t, settings.burn_override);
  const occurrences = expandPlanned(planned, settings.graduation_date);
  const runway = computeRunway({
    today: t,
    graduation: settings.graduation_date,
    reserve: settings.emergency_reserve,
    funds: cash + assetTotal,
    burn: burn.burn,
    planned: occurrences,
  });
  const monthSpend = spend.filter((x) => wibDate(x.occurred_at) >= monthStart(t)).reduce((a, x) => a + x.effective, 0);
  return { today: t, runway, burn, accounts, assets, cash, assetTotal, monthSpend, occurrences, spend };
}

/** Monthly totals (routine vs one-off) for the last `months` months including the current one. */
export function monthlyTotals(spend: SpendTx[], t: ISODate, months: number) {
  const out: { month: ISODate; routine: number; oneOff: number; total: number; current: boolean }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = addMonths(monthStart(t), -i);
    const rows = spend.filter((x) => monthStart(wibDate(x.occurred_at)) === m);
    const oneOff = rows.filter((x) => x.is_one_off).reduce((a, x) => a + x.effective, 0);
    const routine = rows.filter((x) => !x.is_one_off).reduce((a, x) => a + x.effective, 0);
    out.push({ month: m, routine, oneOff, total: routine + oneOff, current: i === 0 });
  }
  return out;
}
